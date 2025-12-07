
import { GoogleGenAI } from "@google/genai";
import { EvidenceFile, EvidenceType, Fact, FactAnalysis, FactStatus, AnalysisReport, ChatMessage, ProcessedContent, Citation } from "../types";

/**
 * Converts a File object to a Base64 string for the API.
 */
const fileToGenerativePart = async (file: File): Promise<{ inlineData: { data: string; mimeType: string } }> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result as string;
      const base64String = result.includes(',') ? result.split(',')[1] : result;
      resolve({
        inlineData: {
          data: base64String,
          mimeType: file.type,
        },
      });
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
};

/**
 * Cleans repetitive word loops (Stuttering Hallucinations).
 */
export const cleanRepetitiveLoops = (text: string): string => {
    if (!text) return "";
    const loopRegex = /\b(\w+)(?:[\s,.]+\1\b){3,}/gi;
    let cleaned = text.replace(loopRegex, '$1');
    const phraseLoopRegex = /(.{5,50}?)(?:[\s,.]+\1){3,}/gi;
    cleaned = cleaned.replace(phraseLoopRegex, '$1');
    return cleaned;
};

/**
 * Sanitizes the raw transcription text to remove AI hallucinations, loops, and time-travel artifacts.
 */
export const sanitizeTranscript = (rawText: string): { timestamp: string; seconds: number; text: string }[] => {
    const segments: { timestamp: string; seconds: number; text: string }[] = [];
    
    // STRICT FORMATTING: Ensure NEWLINE before every timestamp to force "one speech per line"
    // Regex explanation:
    // Finds any bracketed timestamp [MM:SS] or [HH:MM:SS] or [Pág X]
    // If it's NOT preceded by a newline, insert one.
    let formattedText = rawText
        // Replace "text [00:00]" or "text [00:00:00]" with "text\n[00:00]"
        .replace(/([^\n])\s*(\[\d{1,2}:\d{2}(?::\d{2})?\])/g, '$1\n$2')
        // Replace "text 00:00:00" (no brackets) with "\n00:00:00" to catch messy AI output
        .replace(/([^\n])\s+(\d{1,2}:\d{2}:\d{2})/g, '$1\n$2')
        // Replace "text [Pág 1]" with "text\n[Pág 1]"
        .replace(/([^\n])\s*(\[P[áa]g)/g, '$1\n$2')
        // Also handle cases where there might be double brackets or other artifacts
        .replace(/(\n\s*){2,}/g, '\n'); // Remove extra empty lines
    
    const lines = formattedText.split('\n');
    
    // Regex handles: "[00:00]", "[01:00:00]", "00:00", "**[00:00]**", "[Pág 1]", "Page 1:"
    // Groups: 1=Hours(opt), 2=Minutes, 3=Seconds, 4=PageNum, 5=PageNumAlt, 6=Text
    const timestampRegex = /(?:^|[\s\*\-\.\(\[])(?:(?:(\d{1,2}):)?(\d{1,2}):(\d{2})|P[áa]g\.?\s*(\d+)|Page\s*(\d+))(?:\]|\)|:)?[\*\-\)]*\s+(.*)/i;
    
    let lastSeconds = -1;
    let lastText = "";

    for (const line of lines) {
        if (line.trim().length < 2) continue;

        const match = line.match(timestampRegex);
        if (match) {
            // Time parts
            const hours = match[1] ? parseInt(match[1]) : 0;
            const minutes = match[2] ? parseInt(match[2]) : null;
            const secondsPart = match[3] ? parseInt(match[3]) : null;
            
            // Page parts
            const pageNum = match[4] || match[5] ? parseInt(match[4] || match[5]) : null;

            let metricValue = 0;
            let displayTimestamp = "";

            if (minutes !== null && secondsPart !== null) {
                metricValue = (hours * 3600) + (minutes * 60) + secondsPart;
                if (hours > 0) {
                     displayTimestamp = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secondsPart.toString().padStart(2, '0')}`;
                } else {
                     displayTimestamp = `${minutes.toString().padStart(2, '0')}:${secondsPart.toString().padStart(2, '0')}`;
                }
            } else if (pageNum !== null) {
                metricValue = pageNum; 
                displayTimestamp = `Pág ${pageNum}`;
            }

            let text = match[6] ? match[6].trim() : "";

            // Hallucination check
            if (["subtitles by", "inaudível"].some(t => text.toLowerCase().includes(t))) continue;
            
            // Basic cleanup
            text = cleanRepetitiveLoops(text);

            if (text === lastText) continue;

            if (text && text.length > 0) {
                segments.push({
                    timestamp: displayTimestamp,
                    seconds: metricValue,
                    text: text
                });
                lastSeconds = metricValue;
                lastText = text;
            }

        } else {
            // Append text to previous segment if it looks like continuation
            if (segments.length > 0 && line.trim().length > 0) {
                let cleanLine = cleanRepetitiveLoops(line.trim());
                if (!cleanLine.startsWith('[') && cleanLine.length > 1) {
                    segments[segments.length - 1].text += " " + cleanLine;
                }
            }
        }
    }

    return segments;
};

/**
 * Universal Processing Function: Handles Audio, PDF, and Images.
 */
export const processFile = async (apiKey: string, evidenceFile: EvidenceFile): Promise<ProcessedContent> => {
  if (evidenceFile.isVirtual || !evidenceFile.file) {
      throw new Error("Este ficheiro é virtual e não pode ser processado pela API.");
  }

  const ai = new GoogleGenAI({ apiKey: apiKey });
  const model = "gemini-2.5-flash"; 

  // Determine Prompt based on File Type
  let systemInstruction = "";
  let userPrompt = "";

  if (evidenceFile.type === 'AUDIO') {
      systemInstruction = `
          És um Transcritor Forense Profissional.
          A TUA MISSÃO: Transcrever áudio judicial com rigor absoluto em Português de Portugal.
          
          REGRAS DE FORMATAÇÃO (RIGOROSAS):
          1. OBRIGATÓRIO: Coloca cada nova fala numa NOVA LINHA.
          2. OBRIGATÓRIO: Inicia cada fala com o carimbo de tempo [MM:SS] ou [HH:MM:SS].
          3. NUNCA mistures falas diferentes na mesma linha.
          4. Se houver silêncio ou música, ignora.
          5. Transcreve exatamente o que é dito.
          
          EXEMPLO DO FORMATO DESEJADO:
          [00:01] Bom dia a todos.
          [00:03] Bom dia, senhor Juiz.
          [01:15:20] Vamos iniciar a sessão.
      `;
      userPrompt = "Transcreve este áudio. Formato estrito: uma linha por carimbo [MM:SS] ou [HH:MM:SS].";
  } else {
      // PDF / IMAGE / TEXT
      systemInstruction = `
          És um Assistente Legal encarregue de digitalizar Autos de Inquirição e Provas Documentais.
          A TUA MISSÃO: Extrair TODO o texto legível deste documento.
          FORMATO:
          - Se o documento tiver páginas, usa [Pág 1], [Pág 2] em linhas separadas no início de cada página.
          - Divide o texto por parágrafos lógicos.
          - Mantém o rigor do texto original.
      `;
      userPrompt = "Extrai o texto integral. Usa [Pág X] para separar páginas.";
  }

  try {
        const filePart = await fileToGenerativePart(evidenceFile.file);
        
        const response = await ai.models.generateContent({
          model: model,
          contents: {
            parts: [filePart, { text: userPrompt }]
          },
          config: {
            systemInstruction: systemInstruction,
            temperature: 0.2, 
          }
        });

        let rawText = response.text || "";
        if (!rawText.trim()) throw new Error("A IA devolveu uma resposta vazia.");

        // Cleanup
        rawText = rawText.replace(/^```[a-z]*\n/gm, '').replace(/^```/gm, '');

        // Sanitize / Parse
        const segments = sanitizeTranscript(rawText);

        // Fallback for non-timestamped docs (just huge text)
        if (segments.length === 0 && rawText.trim().length > 0) {
            // Split by paragraphs for readability
            const paragraphs = rawText.split(/\n\s*\n/);
            paragraphs.forEach((p, idx) => {
                if (p.trim()) {
                    segments.push({
                        timestamp: evidenceFile.type === 'AUDIO' ? "00:00" : `Parte ${idx + 1}`,
                        seconds: idx,
                        text: p.trim()
                    });
                }
            });
        }

        const fullText = segments.map(s => `[${s.timestamp}] ${s.text}`).join('\n');

        return {
          fileId: evidenceFile.id,
          fileName: evidenceFile.name,
          fullText: fullText,
          segments: segments,
          processedAt: Date.now()
        };

    } catch (error: any) {
        console.error("Processing Error:", error);
        throw new Error(`Falha no processamento de ${evidenceFile.name}: ${error.message}`);
    }
};

export const parseSecondsSafe = (timestamp: string): number => {
    // Handles HH:MM:SS or MM:SS
    if (timestamp.includes(':')) {
        const parts = timestamp.split(':').map(Number);
        if (parts.length === 3) {
            return (parts[0] * 3600) + (parts[1] * 60) + parts[2];
        }
        if (parts.length === 2) {
            return (parts[0] * 60) + parts[1];
        }
    }
    // Handles "Pág X" -> returns X
    const num = timestamp.match(/\d+/);
    return num ? parseInt(num[0]) : 0;
}

/**
 * Analyzes Facts using ALL processed evidence (Audio + Docs).
 */
export const analyzeFactsFromEvidence = async (
  apiKey: string,
  processedData: ProcessedContent[], 
  facts: Fact[],
  peopleMap: Record<string, string>,
  fileMetadata: EvidenceFile[] 
): Promise<AnalysisReport> => {
  if (!processedData.length || !facts.length) {
    throw new Error("São necessários dados e factos.");
  }

  const ai = new GoogleGenAI({ apiKey: apiKey });
  const model = "gemini-2.5-flash";

  const factsList = facts.map((f, i) => `${i + 1}. [ID: ${f.id}] ${f.text}`).join('\n');
  
  // Create Context with Person attribution AND CATEGORY
  const evidenceContext = processedData.map((t) => {
      const personName = peopleMap[t.fileId] || "Desconhecido";
      const fileData = fileMetadata.find(f => f.id === t.fileId);
      const category = fileData?.category || "OTHER";

      return `
<file name="${t.fileName}" person="${personName}" category="${category}">
${t.fullText}
</file>
`;
  }).join('\n');

  // UPDATED SYSTEM PROMPT WITH STRICT TAGS FOR ROBUST PARSING
  const systemInstruction = `
    És um Juiz e Analista Forense.
    
    OBJETIVO: Verificar factos cruzando DEPOIMENTOS (Áudio/Transcrições), AUTOS DE INQUIRIÇÃO (PDF) e OUTRAS PROVAS.
    
    INSTRUÇÕES:
    1. Usa as provas para confirmar ou desmentir cada facto.
    2. Responde num formato estruturado com etiquetas (tags).
    3. RIGOR DAS CITAÇÕES:
       - Para ÁUDIOS (category="TESTIMONY"): Cita literalmente o que foi dito, entre aspas.
       - Para DOCUMENTOS/AUTOS (category="INQUIRY" ou "OTHER"): NÃO copies frases soltas sem contexto. Faz um pequeno RESUMO contextual do que o documento diz sobre o facto.
         Exemplo PDF: "O Auto confirma que o arguido foi visto no local X às Y horas, conforme registo da PSP."
    4. AGRUPAMENTO POR FONTE: Se um facto é confirmado por um ficheiro, agrupa todas as evidências desse ficheiro.
       - Se houver múltiplos momentos, usa o formato: [Ficheiro.mp3 @ 01:20, 05:30].
    
    FORMATO OBRIGATÓRIO PARA CADA FACTO:
    [[FACT]]
    ID: {id do facto}
    [[STATUS]] {Confirmado | Desmentido | Inconclusivo | Não Mencionado} [[END_STATUS]]
    [[SUMMARY]]
    Escreve aqui o resumo da análise baseada nas provas.
    [[END_SUMMARY]]
    [[EVIDENCES]]
    - [NomeDoAudio.mp3 @ 00:00] "Texto citado"
    - [NomeDoAudio.mp3 @ 05:30, 06:10] "Outro texto relevante"
    - [Auto_Policia.pdf @ Pág 1] "Resumo do que consta na página"
    [[END_EVIDENCES]]
    [[END_FACT]]
    
    CONCLUSÃO GLOBAL:
    [[CONCLUSION]]
    Escreve a conclusão geral aqui.
    [[END_CONCLUSION]]
  `;

  const prompt = `
    EVIDÊNCIAS DISPONÍVEIS:
    ${evidenceContext}

    FACTOS A VERIFICAR:
    ${factsList}
  `;

  try {
    const response = await ai.models.generateContent({
      model: model,
      contents: { parts: [{ text: prompt }] },
      config: {
        systemInstruction: systemInstruction,
        temperature: 0.1,
      }
    });

    const rawText = response.text || "";
    
    const results: FactAnalysis[] = [];
    let generalConclusion = "Análise concluída.";
    
    // Robust Extraction using Tags
    const conclusionMatch = rawText.match(/\[\[CONCLUSION\]\]([\s\S]*?)\[\[END_CONCLUSION\]\]/);
    if (conclusionMatch) generalConclusion = conclusionMatch[1].trim();

    const factBlocks = rawText.split('[[FACT]]').slice(1);
    
    for (const block of factBlocks) {
        // Extract ID
        const idMatch = block.match(/ID:\s*(.*?)(\n|\[)/);
        const factId = idMatch ? idMatch[1].trim() : "";
        
        // Extract Status
        const statusMatch = block.match(/\[\[STATUS\]\]([\s\S]*?)\[\[END_STATUS\]\]/);
        const status = statusMatch ? statusMatch[1].trim() as FactStatus : FactStatus.INCONCLUSIVE;

        // Extract Summary
        const summaryMatch = block.match(/\[\[SUMMARY\]\]([\s\S]*?)\[\[END_SUMMARY\]\]/);
        const summaryText = summaryMatch ? summaryMatch[1].trim() : "Sem resumo disponível.";

        // Extract Evidences Section
        const evidencesMatch = block.match(/\[\[EVIDENCES\]\]([\s\S]*?)\[\[END_EVIDENCES\]\]/);
        const evidencesContent = evidencesMatch ? evidencesMatch[1] : "";

        // Parse Citations
        const citations: Citation[] = [];
        // Regex to catch [File @ Time] format more flexibly, including multi-time
        const citationRegex = /\[\s*(.*?)\s*@\s*(.*?)\s*\]/g;
        let match;
        
        while ((match = citationRegex.exec(evidencesContent)) !== null) {
            const fileNameRef = match[1].trim();
            const timestampGroup = match[2].trim();
            
            // Handle multiple timestamps in one block: "01:20, 05:30"
            const timestamps = timestampGroup.split(',').map(t => t.trim());

            // Fuzzy Match File Name (Case Insensitive)
            const source = processedData.find(d => 
                d.fileName.toLowerCase().includes(fileNameRef.toLowerCase()) || 
                fileNameRef.toLowerCase().includes(d.fileName.toLowerCase())
            );
            
            const fileMeta = fileMetadata.find(f => f.id === source?.fileId);
            const isDocument = fileMeta?.category !== 'TESTIMONY';

            if (source) {
                // Add a citation for each timestamp found
                timestamps.forEach(ts => {
                    const seconds = parseSecondsSafe(ts);
                    let text = "Texto indisponível";
                    
                    if (isDocument) {
                         // Fallback logic for docs
                         const seg = source.segments.reduce((prev, curr) => {
                             return Math.abs(curr.seconds - seconds) < Math.abs(prev.seconds - seconds) ? curr : prev;
                        }, source.segments[0]);
                        text = seg ? seg.text : text;
                    } else {
                        // Audio: Keep strict context
                        const centerIdx = source.segments.findIndex(s => Math.abs(s.seconds - seconds) < 2);
                        if (centerIdx !== -1) {
                            const start = Math.max(0, centerIdx - 1);
                            const end = Math.min(source.segments.length, centerIdx + 6);
                            text = source.segments.slice(start, end).map(s => s.text).join(" ");
                        }
                    }

                    citations.push({
                        fileId: source.fileId,
                        fileName: source.fileName,
                        timestamp: ts,
                        seconds: seconds,
                        text: text
                    });
                });
            }
        }

        if (factId) {
            results.push({
                factId: factId,
                factText: facts.find(f => f.id === factId)?.text || "Desconhecido",
                status: status,
                summary: summaryText,
                citations: citations
            });
        }
    }

    return {
      id: Date.now().toString(),
      name: `Relatório #${Math.floor(Date.now() / 1000).toString().slice(-4)}`,
      generatedAt: new Date().toISOString(),
      generalConclusion,
      results
    };

  } catch (error: any) {
    throw new Error(`Erro na análise: ${error.message}`);
  }
};

/**
 * Chat Function
 */
export const chatWithEvidence = async (
  apiKey: string,
  processedData: ProcessedContent[],
  history: ChatMessage[],
  currentMessage: string,
  peopleMap: Record<string, string>,
  fileMetadata: EvidenceFile[]
): Promise<string> => {
   const ai = new GoogleGenAI({ apiKey: apiKey });
   const model = "gemini-2.5-flash"; 

   try {
    const formattedHistory = history.map(h => `${h.role === 'user' ? 'User' : 'AI'}: ${h.text}`).join('\n');
    
    const evidenceContext = processedData.map(t => {
        const fileData = fileMetadata.find(f => f.id === t.fileId);
        const category = fileData?.category || "OTHER";
        return `
        <document name="${t.fileName}" person="${peopleMap[t.fileId] || 'N/A'}" category="${category}">
        ${t.fullText}
        </document>
    `;
    }).join('\n\n');

    const prompt = `
        BASE DE DADOS (Áudios, Autos, Documentos):
        ${evidenceContext}

        HISTÓRICO:
        ${formattedHistory}

        PERGUNTA:
        ${currentMessage}
        
        INSTRUÇÕES:
        1. Consulta TUDO antes de responder.
        2. Distingue entre o que foi dito em depoimento (category="TESTIMONY") e o que está nos autos (category="INQUIRY").
        3. AGRUPAMENTO POR FONTE: Se encontrares várias evidências no mesmo ficheiro, agrupa-as.
        4. CITAÇÕES MÚLTIPLAS: Se um ficheiro tem vários momentos relevantes, lista-os no formato: [Ficheiro.mp3 @ 01:00, 02:30, 05:15].
        5. Dá respostas completas e explicativas.
        
        INSTRUÇÃO ESPECIAL - DETEÇÃO DE PESSOAS:
        Se a pergunta envolver identificar pessoas (testemunhas, arguidos, etc.), NO FINAL DA RESPOSTA, gera uma etiqueta oculta com a lista.
        
        IMPORTANTE: Tenta associar cada pessoa ao seu ficheiro de origem (onde é inquirida ou onde presta depoimento), baseando-te na identificação feita no início do texto.
        
        FORMATO OBRIGATÓRIO PARA DETEÇÃO:
        [[DETECTED_PEOPLE: Nome da Pessoa | Nome do Ficheiro, Outra Pessoa | Outro Ficheiro, Pessoa Sem Ficheiro]]
        
        Exemplo: [[DETECTED_PEOPLE: João Silva | depoimento_joao.mp3, Maria Santos | Auto_01.pdf]]
        Nota: Usa o caracter '|' para separar o nome da pessoa do nome do ficheiro.
    `;

    const response = await ai.models.generateContent({
        model: model,
        contents: { parts: [{ text: prompt }] },
        config: { temperature: 0.2 }
    });

    return cleanRepetitiveLoops(response.text || "Sem resposta.");
   } catch (error) {
     return "Erro ao processar chat.";
   }
};
