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
    let formattedText = rawText
        .replace(/([^\n])\s*(\[\d{1,2}:\d{2}(?::\d{2})?\])/g, '$1\n$2')
        .replace(/([^\n])\s+(\d{1,2}:\d{2}:\d{2})/g, '$1\n$2')
        .replace(/([^\n])\s*(\[P[áa]g)/g, '$1\n$2')
        .replace(/(\n\s*){2,}/g, '\n'); 
    
    const lines = formattedText.split('\n');
    
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
          
          REGRAS DE DIARIZAÇÃO (IDENTIFICAÇÃO DE INTERLOCUTORES):
          1. Tenta identificar quem fala pelo contexto (ex: "Senhor Juiz", "Senhora Testemunha").
          2. Se souberes o nome/papel, usa: [MM:SS] **Juiz:** Texto...
          3. Se não souberes, usa identificadores genéricos consistentes: [MM:SS] **Voz 1:** Texto... / [MM:SS] **Voz 2:** Texto...
          
          REGRAS DE FORMATAÇÃO (RIGOROSAS):
          1. OBRIGATÓRIO: Coloca cada nova fala numa NOVA LINHA.
          2. OBRIGATÓRIO: Inicia cada fala com o carimbo de tempo [MM:SS] ou [HH:MM:SS].
          3. Formato da linha: [Tempo] **Interlocutor:** O que foi dito.
          
          EXEMPLO DO FORMATO DESEJADO:
          [00:01] **Juiz:** Bom dia a todos.
          [00:03] **Voz 1:** Bom dia, senhor Juiz.
          [01:15:20] **Voz 2:** Não me recordo disso.
      `;
      userPrompt = "Transcreve este áudio. Identifica os interlocutores (Voz 1, Voz 2...) e usa o formato [MM:SS] **Nome:** Texto.";
  } else {
      // PDF / IMAGE / TEXT
      systemInstruction = `
          És um Assistente Legal encarregue de digitalizar Autos de Inquirição e Provas Documentais.
          A TUA MISSÃO: Extrair TODO o texto legível deste documento.
          FORMATO:
          - Se o documento tiver páginas, usa [Pág 1], [Pág 2] em linhas separadas no início de cada página.
          - Divide o texto por parágrafos lógicos.
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

        // Fallback for non-timestamped docs
        if (segments.length === 0 && rawText.trim().length > 0) {
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
    if (timestamp.includes(':')) {
        const parts = timestamp.split(':').map(Number);
        if (parts.length === 3) {
            return (parts[0] * 3600) + (parts[1] * 60) + parts[2];
        }
        if (parts.length === 2) {
            return (parts[0] * 60) + parts[1];
        }
    }
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

  const systemInstruction = `
    És um Juiz e Analista Forense.
    OBJETIVO: Verificar factos cruzando DEPOIMENTOS e DOCUMENTOS.
    
    FORMATO OBRIGATÓRIO PARA CADA FACTO:
    [[FACT]]
    ID: {id do facto}
    [[STATUS]] {Confirmado | Desmentido | Inconclusivo | Não Mencionado} [[END_STATUS]]
    [[SUMMARY]] Resumo da análise [[END_SUMMARY]]
    [[EVIDENCES]]
    - [NomeDoAudio.mp3 @ 00:00] "Texto citado"
    [[END_EVIDENCES]]
    [[END_FACT]]
    
    CONCLUSÃO GLOBAL:
    [[CONCLUSION]] Conclusão geral [[END_CONCLUSION]]
  `;

  const prompt = `EVIDÊNCIAS:\n${evidenceContext}\n\nFACTOS:\n${factsList}`;

  try {
    const response = await ai.models.generateContent({
      model: model,
      contents: { parts: [{ text: prompt }] },
      config: { systemInstruction: systemInstruction, temperature: 0.1 }
    });

    const rawText = response.text || "";
    const results: FactAnalysis[] = [];
    let generalConclusion = "Análise concluída.";
    
    const conclusionMatch = rawText.match(/\[\[CONCLUSION\]\]([\s\S]*?)\[\[END_CONCLUSION\]\]/);
    if (conclusionMatch) generalConclusion = conclusionMatch[1].trim();

    const factBlocks = rawText.split('[[FACT]]').slice(1);
    
    for (const block of factBlocks) {
        const idMatch = block.match(/ID:\s*(.*?)(\n|\[)/);
        const factId = idMatch ? idMatch[1].trim() : "";
        const statusMatch = block.match(/\[\[STATUS\]\]([\s\S]*?)\[\[END_STATUS\]\]/);
        const status = statusMatch ? statusMatch[1].trim() as FactStatus : FactStatus.INCONCLUSIVE;
        const summaryMatch = block.match(/\[\[SUMMARY\]\]([\s\S]*?)\[\[END_SUMMARY\]\]/);
        const summaryText = summaryMatch ? summaryMatch[1].trim() : "Sem resumo disponível.";
        const evidencesMatch = block.match(/\[\[EVIDENCES\]\]([\s\S]*?)\[\[END_EVIDENCES\]\]/);
        const evidencesContent = evidencesMatch ? evidencesMatch[1] : "";

        const citations: Citation[] = [];
        const citationRegex = /\[\s*(.*?)\s*@\s*(.*?)\s*\]/g;
        let match;
        
        while ((match = citationRegex.exec(evidencesContent)) !== null) {
            const fileNameRef = match[1].trim();
            const timestampGroup = match[2].trim();
            const timestamps = timestampGroup.split(',').map(t => t.trim());

            const source = processedData.find(d => 
                d.fileName.toLowerCase().includes(fileNameRef.toLowerCase()) || 
                fileNameRef.toLowerCase().includes(d.fileName.toLowerCase())
            );
            
            const fileMeta = fileMetadata.find(f => f.id === source?.fileId);
            const isDocument = fileMeta?.category !== 'TESTIMONY';

            if (source) {
                timestamps.forEach(ts => {
                    const seconds = parseSecondsSafe(ts);
                    let text = "Texto indisponível";
                    
                    if (isDocument) {
                         const seg = source.segments.reduce((prev, curr) => {
                             return Math.abs(curr.seconds - seconds) < Math.abs(prev.seconds - seconds) ? curr : prev;
                        }, source.segments[0]);
                        text = seg ? seg.text : text;
                    } else {
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
        BASE DE DADOS:
        ${evidenceContext}

        HISTÓRICO:
        ${formattedHistory}

        PERGUNTA:
        ${currentMessage}
        
        INSTRUÇÕES DE CITAÇÃO (CRÍTICO):
        Quando a resposta depender de um ficheiro de áudio, tens de usar uma referência clicável.
        Mesmo que identifiques o orador (ex: "Voz 1"), tens de incluir o botão de tempo a seguir.
        
        FORMATO OBRIGATÓRIO DOS BOTÕES:
        [NomeDoFicheiro.mp3 @ MM:SS]
        
        EXEMPLOS CORRETOS:
        - "A Voz 1 afirmou que não estava lá [Depoimento.mp3 @ 01:23]."
        - "O arguido negou tudo [Interrogatorio.wav @ 05:40]."
        
        INSTRUÇÕES GERAIS:
        1. Consulta TUDO antes de responder.
        2. Distingue entre depoimento (category="TESTIMONY") e autos (category="INQUIRY").
        3. Se houver nomes como "Voz 1" ou "Voz 2", usa-os na resposta.
        
        DETEÇÃO DE PESSOAS:
        [[DETECTED_PEOPLE: Nome | Ficheiro, ...]]
    `;

    const response = await ai.models.generateContent({
        model: model,
        contents: { parts: [{ text: prompt }] },
        config: { temperature: 0.2 }
    });

    return cleanRepetitiveLoops(response.text || "Sem resposta.");
   } catch (error: any) {
     console.error("Chat API Error:", error);
     throw error;
   }
};