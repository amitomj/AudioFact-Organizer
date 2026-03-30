
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
    
    let formattedText = rawText
        .replace(/([^\n])\s*(\[\d{1,2}:\d{2}(?::\d{2})?\])/g, '$1\n$2')
        .replace(/([^\n])\s+(\d{1,2}:\d{2}:\d{2})/g, '$1\n$2')
        .replace(/([^\n])\s*(\[P[áa]g)/g, '$1\n$2')
        .replace(/(\n\s*){2,}/g, '\n'); 
    
    const lines = formattedText.split('\n');
    const timestampRegex = /(?:^|[\s\*\-\.\(\[])(?:(?:(\d{1,2}):)?(\d{1,2}):(\d{2})|P[áa]g\.?\s*(\d+)|Page\s*(\d+))(?:\]|\)|:)?[\*\-\)]*\s+(.*)/i;
    
    for (const line of lines) {
        if (line.trim().length < 2) continue;

        const match = line.match(timestampRegex);
        if (match) {
            const hours = match[1] ? parseInt(match[1]) : 0;
            const minutes = match[2] ? parseInt(match[2]) : null;
            const secondsPart = match[3] ? parseInt(match[3]) : null;
            const pageNum = match[4] || match[5] ? parseInt(match[4] || match[5]) : null;

            let metricValue = 0;
            let displayTimestamp = "";

            if (minutes !== null && secondsPart !== null) {
                metricValue = (hours * 3600) + (minutes * 60) + secondsPart;
                displayTimestamp = hours > 0 
                    ? `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secondsPart.toString().padStart(2, '0')}`
                    : `${minutes.toString().padStart(2, '0')}:${secondsPart.toString().padStart(2, '0')}`;
            } else if (pageNum !== null) {
                metricValue = pageNum; 
                displayTimestamp = `Pág ${pageNum}`;
            }

            let text = match[6] ? match[6].trim() : "";
            if (["subtitles by", "inaudível"].some(t => text.toLowerCase().includes(t))) continue;
            text = cleanRepetitiveLoops(text);

            if (text && text.length > 0) {
                segments.push({ timestamp: displayTimestamp, seconds: metricValue, text: text });
            }
        } else if (segments.length > 0 && line.trim().length > 0) {
            let cleanLine = cleanRepetitiveLoops(line.trim());
            if (!cleanLine.startsWith('[') && cleanLine.length > 1) {
                segments[segments.length - 1].text += " " + cleanLine;
            }
        }
    }
    return segments;
};

/**
 * Universal Processing Function: Handles Audio, PDF, and Images.
 */
export const processFile = async (evidenceFile: EvidenceFile): Promise<ProcessedContent> => {
  if (evidenceFile.isVirtual || !evidenceFile.file) {
      throw new Error("Este ficheiro é virtual e não pode ser processado.");
  }

  const APP_MAX_SIZE = 90 * 1024 * 1024;
  if (evidenceFile.file.size > APP_MAX_SIZE) {
      throw new Error(`O ficheiro "${evidenceFile.name}" excede o limite de 90MB. Por favor, comprima-o.`);
  }

  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const model = "gemini-3-flash-preview"; 

  let systemInstruction = "";
  let userPrompt = "";

  if (evidenceFile.type === 'AUDIO') {
      systemInstruction = `És um Transcritor Forense Profissional. Transcreve com rigor absoluto. Diarização: usa [MM:SS] **Interlocutor:** Texto... Se não souberes o nome, usa Voz 1, Voz 2.`;
      userPrompt = "Transcreve este áudio na íntegra.";
  } else {
      systemInstruction = `És um Assistente Legal. Extrai TODO o texto deste documento. Usa [Pág X] para separar páginas.`;
      userPrompt = "Extrai o texto integral deste documento.";
  }

  try {
        const filePart = await fileToGenerativePart(evidenceFile.file);
        const response = await ai.models.generateContent({
          model: model,
          contents: { parts: [filePart, { text: userPrompt }] },
          config: { systemInstruction: systemInstruction, temperature: 0.1 }
        });

        let rawText = response.text || "";
        const segments = sanitizeTranscript(rawText);
        if (segments.length === 0 && rawText.trim().length > 0) {
            rawText.split(/\n\s*\n/).forEach((p, idx) => {
                if (p.trim()) segments.push({ timestamp: `Parte ${idx + 1}`, seconds: idx, text: p.trim() });
            });
        }

        return {
          fileId: evidenceFile.id,
          fileName: evidenceFile.name,
          fullText: segments.map(s => `[${s.timestamp}] ${s.text}`).join('\n'),
          segments: segments,
          processedAt: Date.now()
        };
    } catch (error: any) {
        throw new Error(error.message || `Falha no processamento de ${evidenceFile.name}`);
    }
};

export const parseSecondsSafe = (timestamp: string): number => {
    if (timestamp.toLowerCase().includes('pág')) {
        return parseInt(timestamp.match(/\d+/)?.[0] || "1");
    }
    const parts = timestamp.split(':').map(Number);
    if (parts.length === 3) return (parts[0] * 3600) + (parts[1] * 60) + parts[2];
    if (parts.length === 2) return (parts[0] * 60) + parts[1];
    return 0;
};

/**
 * Analyze Facts from Evidence
 */
export const analyzeFactsFromEvidence = async (
  processedData: ProcessedContent[], 
  facts: Fact[],
  peopleMap: Record<string, string>,
  fileMetadata: EvidenceFile[] 
): Promise<AnalysisReport> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const model = "gemini-3-pro-preview"; 

  const factsList = facts.map((f, i) => `${i + 1}. [ID: ${f.id}] ${f.text}`).join('\n');
  const evidenceContext = processedData.map(t => `<file name="${t.fileName}" person="${peopleMap[t.fileId] || "N/A"}">${t.fullText}</file>`).join('\n');

  // Updated Prompt with explicit END tags for all fields
  const systemInstruction = `És um Juiz Analista. Verifica factos cruzando evidências.
  Responde EXCLUSIVAMENTE no seguinte formato para cada facto:
  [[FACT]]
  ID: {id_do_facto}
  [[STATUS]] {Confirmado|Desmentido|Inconclusivo|Não Mencionado} [[END_STATUS]]
  [[SUMMARY]] {Explicação detalhada da conclusão baseada nas provas} [[END_SUMMARY]]
  [[EVIDENCES]] [Nome_Ficheiro @ 00:00] ou [Nome_Ficheiro @ Pág X] [[END_EVIDENCES]]
  [[END_FACT]]

  No fim de tudo:
  [[CONCLUSION]] {Parecer geral sobre o conjunto de factos} [[END_CONCLUSION]]`;

  try {
    const response = await ai.models.generateContent({
      model: model,
      contents: { parts: [{ text: `EVIDÊNCIAS:\n${evidenceContext}\n\nFACTOS:\n${factsList}` }] },
      config: { systemInstruction: systemInstruction, temperature: 0.1 }
    });

    const rawText = response.text || "";
    const results: FactAnalysis[] = [];
    let generalConclusion = "Análise concluída.";
    
    const conclusionMatch = rawText.match(/\[\[CONCLUSION\]\]([\s\S]*?)\[\[END_CONCLUSION\]\]/);
    if (conclusionMatch) generalConclusion = conclusionMatch[1].trim();

    const factBlocks = rawText.split('[[FACT]]').slice(1);
    
    factBlocks.forEach(block => {
        const idMatch = block.match(/ID:\s*(.*?)(\n|\[)/);
        const statusMatch = block.match(/\[\[STATUS\]\]([\s\S]*?)\[\[END_STATUS\]\]/);
        const summaryMatch = block.match(/\[\[SUMMARY\]\]([\s\S]*?)\[\[END_SUMMARY\]\]/);
        const evidencesContentMatch = block.match(/\[\[EVIDENCES\]\]([\s\S]*?)\[\[END_EVIDENCES\]\]/);

        const citations: Citation[] = [];
        const citationRegex = /\[\s*(.*?)\s*@\s*(.*?)\s*\]/g;
        let cMatch;
        const evidenceStr = evidencesContentMatch?.[1] || "";
        
        while ((cMatch = citationRegex.exec(evidenceStr)) !== null) {
            const fileNameRef = cMatch[1].trim();
            const timeOrPageRef = cMatch[2].trim();
            
            // Try fuzzy matching file name
            const source = processedData.find(d => 
                d.fileName.toLowerCase().includes(fileNameRef.toLowerCase()) || 
                fileNameRef.toLowerCase().includes(d.fileName.toLowerCase())
            );
            
            if (source) {
                citations.push({
                    fileId: source.fileId,
                    fileName: source.fileName,
                    timestamp: timeOrPageRef,
                    seconds: parseSecondsSafe(timeOrPageRef),
                    text: "Referência à fonte."
                });
            }
        }

        if (idMatch) {
            const fId = idMatch[1].trim();
            results.push({
                factId: fId,
                factText: facts.find(f => f.id === fId)?.text || "Facto não encontrado",
                status: (statusMatch?.[1].trim() as FactStatus) || FactStatus.INCONCLUSIVE,
                summary: summaryMatch?.[1].trim() || "Análise não disponível.",
                citations
            });
        }
    });

    return { id: Date.now().toString(), name: `Relatório #${Date.now().toString().slice(-4)}`, generatedAt: new Date().toISOString(), generalConclusion, results };
  } catch (error: any) {
    throw new Error(`Erro na análise: ${error.message}`);
  }
};

/**
 * Chat with Evidence
 */
export const chatWithEvidence = async (
  processedData: ProcessedContent[],
  history: ChatMessage[],
  currentMessage: string,
  peopleMap: Record<string, string>,
  fileMetadata: EvidenceFile[]
): Promise<string> => {
   const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
   const model = "gemini-3-flash-preview"; 
   try {
    const evidenceContext = processedData.map(t => `<doc name="${t.fileName}">${t.fullText}</doc>`).join('\n');
    const response = await ai.models.generateContent({
        model: model,
        contents: { parts: [{ text: `EVIDÊNCIAS:\n${evidenceContext}\n\nPERGUNTA: ${currentMessage}\n\nCITAÇÃO SEMPRE NO FORMATO: [Nome_Ficheiro @ MM:SS] ou [Nome_Ficheiro @ Pág X]` }] },
        config: { temperature: 0.2 }
    });
    return cleanRepetitiveLoops(response.text || "Sem resposta.");
   } catch (error: any) { throw error; }
};
