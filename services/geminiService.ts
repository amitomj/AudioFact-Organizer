
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

const formatDialogue = (text: string): string => {
    if (!text) return "";
    let formatted = text;
    formatted = formatted.replace(/([.!?])\s+([-–—])\s*/g, "$1\n$2 ");
    formatted = formatted.replace(/([.!?])\s+([A-ZÀ-Ú][a-zçáéíóúâêôãõ]+:)/g, "$1\n$2");
    return formatted;
};

/**
 * Sanitizes the raw transcription text to remove AI hallucinations, loops, and time-travel artifacts.
 */
export const sanitizeTranscript = (rawText: string): { timestamp: string; seconds: number; text: string }[] => {
    const segments: { timestamp: string; seconds: number; text: string }[] = [];
    
    // STRICT FORMATTING: Ensure NEWLINE before every timestamp to force "one speech per line"
    // Regex matches: Space(optional) + [MM:SS] or [Page]
    // Replaces with: \n[MM:SS]
    let formattedText = rawText
        .replace(/(\s*)(\[\d{1,3}:\d{2}\])/g, '\n$2') 
        .replace(/(\s*)(\[P[áa]g)/g, '\n$2');
    
    const lines = formattedText.split('\n');
    
    // Regex handles: "[00:00]", "00:00", "**[00:00]**", "[Pág 1]", "Page 1:"
    const timestampRegex = /(?:^|[\s\*\-\.\(\[])(?:(\d{1,3}):(\d{2})|P[áa]g\.?\s*(\d+)|Page\s*(\d+))(?:\]|\)|:)?[\*\-\)]*\s+(.*)/i;
    
    let lastSeconds = -1;
    let lastText = "";

    for (const line of lines) {
        if (line.length < 3) continue;

        const match = line.match(timestampRegex);
        if (match) {
            // Check if it is Time (MM:SS) or Page (Pág X)
            const minutes = match[1] ? parseInt(match[1]) : null;
            const secondsPart = match[2] ? parseInt(match[2]) : null;
            const pageNum = match[3] || match[4] ? parseInt(match[3] || match[4]) : null;

            let metricValue = 0;
            let displayTimestamp = "";

            if (minutes !== null && secondsPart !== null) {
                metricValue = (minutes * 60) + secondsPart;
                displayTimestamp = `${match[1].padStart(2, '0')}:${match[2].padStart(2, '0')}`;
            } else if (pageNum !== null) {
                metricValue = pageNum; 
                displayTimestamp = `Pág ${pageNum}`;
            }

            let text = match[5] ? match[5].trim() : "";

            // Hallucination check
            if (["subtitles by", "inaudível"].some(t => text.toLowerCase().includes(t))) continue;
            
            text = cleanRepetitiveLoops(text);

            if (text === lastText) continue;

            if (text && text.length > 1) {
                segments.push({
                    timestamp: displayTimestamp,
                    seconds: metricValue,
                    text: text
                });
                lastSeconds = metricValue;
                lastText = text;
            }

        } else {
            // Append text to previous segment
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
          És um Transcritor Forense.
          A TUA MISSÃO: Transcrever áudio judicial com rigor absoluto.
          
          REGRAS DE FORMATAÇÃO (CRÍTICO):
          1. Começa SEMPRE uma nova linha para cada novo carimbo de tempo.
          2. O formato DEVE ser: [MM:SS] Texto da fala.
          3. NUNCA coloques duas falas na mesma linha.
          4. Se o orador mudar, cria nova linha com novo carimbo.
          
          EXEMPLO OBRIGATÓRIO:
          [00:01] Bom dia.
          [00:02] Bom dia, senhor Doutor.
          [00:05] Como se chama?
      `;
      userPrompt = "Transcreve este áudio em PT-PT. Uma linha por carimbo [MM:SS].";
  } else {
      // PDF / IMAGE / TEXT
      systemInstruction = `
          És um Assistente Legal encarregue de digitalizar Autos de Inquirição e Provas Documentais.
          A TUA MISSÃO: Extrair TODO o texto legível deste documento.
          FORMATO:
          - Se o documento tiver páginas, usa [Pág 1], [Pág 2] em linhas separadas.
          - Divide o texto por parágrafos lógicos para facilitar a leitura.
          - Mantém o rigor do texto original.
      `;
      userPrompt = "Extrai o texto integral deste documento. Se houver numeração de páginas, indica [Pág X] no início da página.";
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

const parseSecondsSafe = (timestamp: string): number => {
    // Handles MM:SS
    if (timestamp.includes(':')) {
        const parts = timestamp.split(':');
        return (parseInt(parts[0]) * 60) + parseInt(parts[1]);
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
  fileMetadata: EvidenceFile[] // Needed to know the Category
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

  const systemInstruction = `
    És um Juiz e Analista Forense.
    
    OBJETIVO: Verificar factos cruzando DEPOIMENTOS (Áudio/Transcrições), AUTOS DE INQUIRIÇÃO (PDF) e OUTRAS PROVAS.
    
    INSTRUÇÕES:
    1. **Contexto:** Usa a etiqueta 'category' para distinguir Depoimentos (viva voz) de Autos (documentos) e Outras Provas.
    2. **Filtro Temporal e Temático:** Ignora informação fora de contexto.
    3. **Conjugação de Prova:** Valoriza quando um documento corrobora um depoimento.
    4. **Princípio da Pertinência:** Cita apenas frases que provam ou desmentem o facto. Não divagues.
    
    OUTPUT JSON-LIKE:
    [[FACT]]
    ID: {id}
    STATUS: {Confirmado | Desmentido | Inconclusivo | Não Mencionado}
    SUMMARY: {Resumo focado}
    EVIDENCES:
    - [Ficheiro.ext @ 00:00]
    [[END_FACT]]
    
    [[CONCLUSION]]
    {Conclusão Global}
    [[END_CONCLUSION]]
  `;

  const prompt = `
    EVIDÊNCIAS:
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
    
    const conclusionMatch = rawText.match(/\[\[CONCLUSION\]\]([\s\S]*?)\[\[END_CONCLUSION\]\]/);
    if (conclusionMatch) generalConclusion = conclusionMatch[1].trim();

    const factBlocks = rawText.split('[[FACT]]').slice(1);
    
    for (const block of factBlocks) {
        const content = block.split('[[END_FACT]]')[0];
        const idMatch = content.match(/ID:\s*(.*)/);
        const statusMatch = content.match(/STATUS:\s*(.*)/);
        const summaryMatch = content.match(/SUMMARY:\s*([\s\S]*?)EVIDENCES:/);
        
        const summaryText = summaryMatch ? summaryMatch[1].trim() : "";
        
        const citationRegex = /\[\s*(.*?)\s*@\s*(.*?)\s*\]/g;
        const citations: Citation[] = [];
        
        let match;
        while ((match = citationRegex.exec(content)) !== null) {
            const fileName = match[1].trim();
            const timestamp = match[2].trim();
            
            const source = processedData.find(d => d.fileName.includes(fileName) || fileName.includes(d.fileName));
            if (source) {
                const seconds = parseSecondsSafe(timestamp);
                let text = "Texto indisponível";
                
                // Context expansion logic (1 before, 5 after)
                const centerIdx = source.segments.findIndex(s => Math.abs(s.seconds - seconds) < 2);
                if (centerIdx !== -1) {
                    const start = Math.max(0, centerIdx - 1);
                    const end = Math.min(source.segments.length, centerIdx + 6);
                    text = source.segments.slice(start, end).map(s => s.text).join(" ");
                } else {
                    // Fallback closest
                    const seg = source.segments.reduce((prev, curr) => {
                         return Math.abs(curr.seconds - seconds) < Math.abs(prev.seconds - seconds) ? curr : prev;
                    }, source.segments[0]);
                    text = seg ? seg.text : text;
                }

                citations.push({
                    fileId: source.fileId,
                    fileName: source.fileName,
                    timestamp: timestamp,
                    seconds: seconds,
                    text: text
                });
            }
        }

        if (idMatch && statusMatch) {
            results.push({
                factId: idMatch[1].trim(),
                factText: facts.find(f => f.id === idMatch[1].trim())?.text || "Desconhecido",
                status: statusMatch[1].trim() as FactStatus,
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
        3. Cita usando [Ficheiro @ Marcador].
        4. Sê conciso e objetivo.
    `;

    const response = await ai.models.generateContent({
        model: model,
        contents: { parts: [{ text: prompt }] },
        config: { temperature: 0.1 }
    });

    return cleanRepetitiveLoops(response.text || "Sem resposta.");
   } catch (error) {
     return "Erro ao processar chat.";
   }
};
