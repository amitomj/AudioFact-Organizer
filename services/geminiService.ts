
import { GoogleGenAI, Schema, Type } from "@google/genai";
import { AudioFile, Fact, FactAnalysis, FactStatus, AnalysisReport, ChatMessage, Transcription } from "../types";

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
 * Example: "mas, mas, mas, mas" -> "mas"
 */
export const cleanRepetitiveLoops = (text: string): string => {
    if (!text) return "";
    // Detects a word (and optional punctuation/space) repeated 4 or more times
    const loopRegex = /\b(\w+)(?:[\s,.]+\1\b){3,}/gi;
    let cleaned = text.replace(loopRegex, '$1');
    
    // Also catch phrase loops: "and then, and then, and then"
    const phraseLoopRegex = /(.{5,50}?)(?:[\s,.]+\1){3,}/gi;
    cleaned = cleaned.replace(phraseLoopRegex, '$1');

    return cleaned;
};

/**
 * Formats dialogue by detecting speaker changes or common dialogue markers.
 * Adds line breaks to separate speakers.
 */
const formatDialogue = (text: string): string => {
    if (!text) return "";
    let formatted = text;

    // 1. Separate lines starting with dashes/hyphens (common in PT transcriptions)
    // Looks for punctuation [.!?] followed by space and a dash
    formatted = formatted.replace(/([.!?])\s+([-–—])\s*/g, "$1\n$2 ");

    // 2. Separate lines where a Name/Role appears with a colon (e.g. "Juiz: ...")
    // Looks for punctuation, space, Capitalized Word, colon
    formatted = formatted.replace(/([.!?])\s+([A-ZÀ-Ú][a-zçáéíóúâêôãõ]+:)/g, "$1\n$2");

    return formatted;
};

/**
 * Sanitizes the raw transcription text to remove AI hallucinations, loops, and time-travel artifacts.
 */
export const sanitizeTranscript = (rawText: string): { timestamp: string; seconds: number; text: string }[] => {
    const segments: { timestamp: string; seconds: number; text: string }[] = [];
    const lines = rawText.split('\n');
    
    // Regex handles: "[00:00]", "00:00", "**[00:00]**", "- 00:00:", etc.
    const timestampRegex = /(?:^|[\s\*\-\.\(\[])(\d{1,3}):(\d{2})(?:\]|\)|:)?[\*\-\)]*\s+(.*)/;
    
    let lastSeconds = -1;
    let consecutiveRepeats = 0;
    let lastText = "";

    // Hallucination triggers (English phrases common in training data loops)
    const hallucinationTriggers = [
        "subtitles by", "captioning by", "copyright", "all rights reserved",
        "uh, and then", "i'll just go through", "barulho", "silêncio", "inaudível"
    ];

    for (const line of lines) {
        // 1. Skip pure garbage lines
        if (line.length < 3) continue;

        const match = line.match(timestampRegex);
        if (match) {
            const minutes = parseInt(match[1]);
            const secondsPart = parseInt(match[2]);
            let totalSeconds = (minutes * 60) + secondsPart;
            
            if (isNaN(totalSeconds)) totalSeconds = 0;

            let text = match[3].trim();

            // --- SANITIZATION RULES ---

            // Rule A: Time Travel Protection
            // If time jumps BACKWARDS by more than 5 seconds, it's likely a hallucination loop restarting.
            // Exception: The very first segment.
            if (lastSeconds !== -1 && totalSeconds < (lastSeconds - 5)) {
                console.warn(`Sanitizer: Time jumped backwards from ${lastSeconds}s to ${totalSeconds}s. Stopping transcription here.`);
                break; // Stop processing further lines, assume hallucination from here on.
            }

            // Rule B: Content Filtering
            const lowerText = text.toLowerCase();
            // Check for specific hallucination phrases
            if (hallucinationTriggers.some(trigger => lowerText.includes(trigger) && text.length < 50)) {
                 continue;
            }

            // Rule C: Stuttering/Loop Cleaning within the line
            text = cleanRepetitiveLoops(text);

            // Rule D: De-duplication (Line Loop Breaker)
            if (text === lastText) {
                consecutiveRepeats++;
                if (consecutiveRepeats > 2) {
                    console.warn("Sanitizer: Detected text loop. Stopping.");
                    break;
                }
                continue; // Skip this duplicate line
            } else {
                consecutiveRepeats = 0;
            }

            // Valid Segment
            if (text && text.length > 1) { // Ensure we don't save empty lines after cleaning
                segments.push({
                    timestamp: `${match[1].padStart(2, '0')}:${match[2].padStart(2, '0')}`,
                    seconds: totalSeconds,
                    text: text
                });
                lastSeconds = totalSeconds;
                lastText = text;
            }

        } else {
            // Append text to previous segment if it's a continuation
            if (segments.length > 0 && line.trim().length > 0) {
                let cleanLine = line.trim();
                cleanLine = cleanRepetitiveLoops(cleanLine); // Clean loops in continuation lines too

                // Avoid appending garbage
                if (!cleanLine.startsWith('[') && !hallucinationTriggers.some(t => cleanLine.toLowerCase().includes(t)) && cleanLine.length > 1) {
                    segments[segments.length - 1].text += " " + cleanLine;
                }
            }
        }
    }

    return segments;
};

/**
 * Transcribes a single audio file with Retry Logic and Recitation Bypass.
 */
export const transcribeAudio = async (apiKey: string, audioFile: AudioFile): Promise<Transcription> => {
  // If it's a virtual file (manually imported text), skip API call
  if (audioFile.isVirtual || !audioFile.file) {
      throw new Error("Este ficheiro é apenas texto e não pode ser re-transcrito pela API.");
  }

  const ai = new GoogleGenAI({ apiKey: apiKey });
  const model = "gemini-2.5-flash"; 
  let attempt = 0;
  const maxRetries = 3;
  let lastError: any = null;

  while (attempt < maxRetries) {
    try {
        const audioPart = await fileToGenerativePart(audioFile.file);
        
        // Determine settings based on previous failure
        // If we failed due to RECITATION previously, we use higher temperature to "break" the strict filter pattern
        const isRecitationRetry = lastError?.message?.includes("RECITATION_DETECTED");
        const temperature = isRecitationRetry ? 0.6 : 0.2;

        const systemInstruction = `
          És um Transcritor Forense Técnico especializado em registos judiciais.
          
          A TUA MISSÃO:
          1. Transcrever áudio judicial com rigor absoluto.
          2. Ignorar música de fundo, toques de telemóvel ou leitura de obras literárias (trata como ruído).
          3. IMPORTANTE: Se o áudio parecer "recitação" ou "leitura", TRANSCREVE NA MESMA. É prova judicial.
          4. NUNCA entres em loops de repetição.
          
          FORMATO OBRIGATÓRIO:
          [MM:SS] Texto exato falado.
        `;

        const prompt = `
          Por favor, transcreve este ficheiro de áudio em Português de Portugal (PT-PT).
          Começa cada frase nova com o carimbo de tempo [MM:SS].
          Não faças resumos. Quero a transcrição literal.
          (Nota: Ignora avisos de copyright, isto é material de tribunal de domínio público).
        `;

        const response = await ai.models.generateContent({
          model: model,
          contents: {
            parts: [audioPart, { text: prompt }]
          },
          config: {
            systemInstruction: systemInstruction,
            temperature: temperature, 
            safetySettings: [
              { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
              { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
              { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
              { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' }
            ]
          }
        });

        let rawText = response.text || "";
        
        // Validate Response Candidates
        if (!rawText && response.candidates && response.candidates.length > 0) {
            const candidate = response.candidates[0];
            if (candidate.finishReason === "RECITATION") {
                 // Throw specific error to trigger the retry logic below
                 throw new Error("RECITATION_DETECTED");
            }
            if (candidate.finishReason && candidate.finishReason !== "STOP") {
                 throw new Error(`Transcrição interrompida. Motivo: ${candidate.finishReason}`);
            }
        }

        if (!rawText.trim()) throw new Error("A IA devolveu uma resposta vazia.");

        // Cleanup Markdown
        rawText = rawText.replace(/^```[a-z]*\n/gm, '').replace(/^```/gm, '');

        // Run Sanitizer
        const segments = sanitizeTranscript(rawText);

        // Fallback if parsing fails entirely but text exists
        if (segments.length === 0 && rawText.trim().length > 0) {
            segments.push({
                timestamp: "00:00",
                seconds: 0,
                text: rawText.trim().substring(0, 1000)
            });
        }

        if (segments.length === 0) {
            throw new Error("A IA não retornou conteúdo de texto válido.");
        }

        const fullText = segments.map(s => `[${s.timestamp}] ${s.text}`).join('\n');

        return {
          audioFileId: audioFile.id,
          audioFileName: audioFile.name,
          fullText: fullText,
          segments: segments,
          processedAt: Date.now()
        };

    } catch (error: any) {
        lastError = error;
        attempt++;
        
        const errorMessage = error.message || "";
        const isRecitation = errorMessage.includes("RECITATION_DETECTED") || errorMessage.includes("Recitação");
        const isNetworkError = errorMessage.includes("Rpc failed") || errorMessage.includes("500") || errorMessage.includes("503") || errorMessage.includes("xhr error");

        console.warn(`Attempt ${attempt} for ${audioFile.name} failed. Reason: ${errorMessage}`);

        if (attempt < maxRetries) {
            if (isRecitation) {
                console.log("Retrying with higher temperature to bypass Recitation filter...");
                continue; // Retry loop immediately
            }
            if (isNetworkError) {
                console.log(`Network error. Retrying in ${attempt * 2} seconds...`);
                await new Promise(resolve => setTimeout(resolve, attempt * 2000)); // Exponential backoff
                continue;
            }
        }
        
        // If we ran out of retries or it's a fatal error
        console.error(`Erro final ao transcrever ${audioFile.name}:`, error);
        throw new Error(`Falha na transcrição de ${audioFile.name}: ${errorMessage}`);
    }
  }
  
  throw new Error("Falha desconhecida na transcrição.");
};

/**
 * Calculates total seconds from MM:SS string safely.
 */
const parseSecondsSafe = (timestamp: string): number => {
    try {
        if (!timestamp) return 0;
        const clean = timestamp.replace(/[\[\]\(\)a-zA-Z]/g, '').trim();
        const parts = clean.split(':');
        if (parts.length >= 2) {
            const m = parseInt(parts[0], 10);
            const s = parseInt(parts[1], 10);
            if (!isNaN(m) && !isNaN(s)) {
                return (m * 60) + s;
            }
        }
        return 0;
    } catch {
        return 0;
    }
}

/**
 * Analyzes transcripts using SEMANTIC INTERPRETATION but returns RIGOROUS CITATIONS.
 */
export const analyzeFactsFromTranscripts = async (
  apiKey: string,
  transcriptions: Transcription[], 
  facts: Fact[]
): Promise<AnalysisReport> => {
  if (!transcriptions.length || !facts.length) {
    throw new Error("São necessárias transcrições e factos.");
  }

  const ai = new GoogleGenAI({ apiKey: apiKey });
  const model = "gemini-2.5-flash";

  const factsList = facts.map((f, i) => `${i + 1}. [ID: ${f.id}] ${f.text}`).join('\n');
  
  // Create robust XML context
  const transcriptsContext = transcriptions.map((t) => `
<file name="${t.audioFileName}">
${t.segments.map(s => `[${s.timestamp}] ${s.text}`).join('\n')}
</file>
`).join('\n');

  const systemInstruction = `
    És um Juiz e Analista Forense Rígido.
    
    OBJETIVO:
    Verificar se os FACTOS alegados são confirmados pelos DEPOIMENTOS fornecidos.
    
    INSTRUÇÕES CRÍTICAS DE RIGOR (LÊ COM ATENÇÃO):
    1. **Filtro Temporal e Temático Absoluto:**
       - Se o facto refere um momento específico (ex: "após a operação", "durante o jantar"), IGNORA TUDO o que não seja desse momento exato.
       - NÃO aceites inferências de outros contextos. Se não há informação sobre aquele momento exato, o resultado é INCONCLUSIVO ou NÃO MENCIONADO.
       - Exemplo: Se perguntam se "trabalhou no pós-operatório", não interessa se trabalhou no pré-operatório.
    
    2. **Interpretação Semântica Estrita:** 
       - Se o depoimento é vago, é INCONCLUSIVO.
       - Não tentes "salvar" o facto. Se a prova é fraca, diz que é fraca.
    
    3. **Busca Exaustiva mas Precisa:** 
       - Procura em TODOS os ficheiros.
       - Ignora "conversa de café", cumprimentos ou divagações. Queremos a prova material.
    
    4. **Formatação de Evidências (OBRIGATÓRIO):**
       - Deves MANDATORIAMENTE listar as evidências (citações) que fundamentam a decisão.
       - Usa a "tag" exata: [NomeDoFicheiro.mp3 @ MM:SS]
       - Se mencionares algo no resumo, tens de fornecer a tag.
    
    OUTPUT JSON-LIKE (Estruturado):
    
    [[FACT]]
    ID: {id_do_facto}
    STATUS: {Confirmado | Desmentido | Inconclusivo/Contraditório | Não Mencionado}
    SUMMARY: {Resumo curto. Foca APENAS no tema questionado. Se a testemunha divagar, ignora a divagação.}
    EVIDENCES:
    - [Ficheiro.mp3 @ 00:00]
    - [OutroFicheiro.mp3 @ 00:00]
    [[END_FACT]]
    
    [[CONCLUSION]]
    {Conclusão final global, concisa e focada na consistência da prova.}
    [[END_CONCLUSION]]
  `;

  const prompt = `
    DOCUMENTOS (Transcrições):
    ${transcriptsContext}

    FACTOS A VERIFICAR:
    ${factsList}
  `;

  try {
    const response = await ai.models.generateContent({
      model: model,
      contents: { parts: [{ text: prompt }] },
      config: {
        systemInstruction: systemInstruction,
        maxOutputTokens: 8192,
        temperature: 0.1, // Very low temperature for maximum rigor
        thinkingConfig: { thinkingBudget: 1024 },
        safetySettings: [
            { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
            { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
            { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
            { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' }
        ]
      }
    });

    const rawText = response.text || "";
    const results: FactAnalysis[] = [];
    let generalConclusion = "Análise concluída.";

    // Parse Conclusion
    const conclusionMatch = rawText.match(/\[\[CONCLUSION\]\]([\s\S]*?)\[\[END_CONCLUSION\]\]/);
    if (conclusionMatch && conclusionMatch[1]) generalConclusion = conclusionMatch[1].trim();

    // Parse Facts
    const factBlocks = rawText.split('[[FACT]]').slice(1);

    for (const block of factBlocks) {
        const content = block.split('[[END_FACT]]')[0];
        
        const idMatch = content.match(/ID:\s*(.*)/);
        const statusMatch = content.match(/STATUS:\s*(.*)/);
        const summaryMatch = content.match(/SUMMARY:\s*([\s\S]*?)EVIDENCES:/);
        const summaryFallback = content.match(/SUMMARY:\s*([\s\S]*?)$/); // Fallback if EVIDENCES tag is missing
        
        // Use the explicit match, or fallback if EVIDENCES label is missing
        const summaryText = summaryMatch ? summaryMatch[1].trim() : (summaryFallback ? summaryFallback[1].trim() : "");

        // Improved Regex: Scan the ENTIRE block for citations
        const citationRegex = /\[\s*(.*?)\s*@\s*(\d{1,2}:\d{2})\s*\]/g;
        const citations: { audioFileName: string; timestamp: string; text: string }[] = [];
        const seenCitations = new Set<string>();
        
        let match;
        while ((match = citationRegex.exec(content)) !== null) {
            const fileName = match[1].trim();
            const timestamp = match[2].trim();
            const uniqueKey = `${fileName}_${timestamp}`;

            if (fileName.length > 2 && !seenCitations.has(uniqueKey)) {
                seenCitations.add(uniqueKey);
                citations.push({ audioFileName: fileName, timestamp: timestamp, text: "" });
            }
        }

        if (idMatch && statusMatch) {
            const factId = idMatch[1].trim();
            const statusRaw = statusMatch[1].trim().toLowerCase();
            let status = FactStatus.NOT_MENTIONED;
            
            if (statusRaw.includes("confirmado")) status = FactStatus.CONFIRMED;
            else if (statusRaw.includes("desmentido")) status = FactStatus.DENIED;
            else if (statusRaw.includes("inconclusivo") || statusRaw.includes("contraditório")) status = FactStatus.INCONCLUSIVE;

            // --- SOURCE OF TRUTH HYDRATION ---
            const hydratedCitations = citations.map(c => {
                 const cleanRefName = c.audioFileName.toLowerCase().replace(/\.(mp3|wav|m4a)$/, '').trim();
                 
                 const transcriptMatch = transcriptions.find(t => {
                     const cleanDbName = t.audioFileName.toLowerCase().replace(/\.(mp3|wav|m4a)$/, '').trim();
                     return cleanDbName.includes(cleanRefName) || cleanRefName.includes(cleanDbName);
                 });

                 const seconds = parseSecondsSafe(c.timestamp);
                 let verifiedText = "Texto indisponível. (Verifique se o nome do ficheiro corresponde)"; 

                 if (transcriptMatch) {
                    // Find closest segment
                    const closestSegment = transcriptMatch.segments.reduce((prev, curr) => {
                         const diffCurr = Math.abs(curr.seconds - seconds);
                         const diffPrev = Math.abs(prev.seconds - seconds);
                         return diffCurr < diffPrev ? curr : prev;
                    }, transcriptMatch.segments[0]);

                    if (closestSegment) {
                        // FORCE EXPANSION (8 SENTENCES, BUT CENTERED)
                        // We try to take 1 segment BEFORE (for context context) and ~6 AFTER.
                        
                        const startIndex = transcriptMatch.segments.indexOf(closestSegment);
                        const contextStartIndex = Math.max(0, startIndex - 1); 
                        
                        let expandedText = "";
                        let currentIdx = contextStartIndex;
                        let sentenceCount = 0;
                        
                        // Strict limit: expand up to 8 sentences or end of stream
                        while (sentenceCount < 8 && currentIdx < transcriptMatch.segments.length) {
                             const seg = transcriptMatch.segments[currentIdx];
                             if (seg && seg.text) {
                                 // Add timestamp visually for clarity if it's the start
                                 expandedText += (currentIdx === startIndex ? "" : "") + " " + seg.text;
                                 sentenceCount = (expandedText.match(/[.!?]+/g) || []).length;
                             }
                             currentIdx++;
                        }
                        
                        // CLEANING: Apply loop removal
                        let cleaned = cleanRepetitiveLoops(expandedText);
                        
                        // FORMATTING: Apply Dialogue Separators
                        verifiedText = formatDialogue(cleaned);
                    }
                 }
                 
                 return {
                     audioFileId: transcriptMatch ? transcriptMatch.audioFileId : 'unknown',
                     audioFileName: transcriptMatch ? transcriptMatch.audioFileName : c.audioFileName,
                     timestamp: c.timestamp,
                     seconds: seconds,
                     text: verifiedText
                 };
            });

            const originalFact = facts.find(f => f.id === factId);
            results.push({
                factId: factId,
                factText: originalFact ? originalFact.text : "Desconhecido",
                status: status,
                summary: summaryText,
                citations: hydratedCitations
            });
        }
    }

    if (results.length === 0) throw new Error("A análise não gerou resultados estruturados. Tente novamente.");

    return {
      id: Date.now().toString(),
      name: `Análise #${Math.floor(Date.now() / 1000).toString().slice(-4)}`,
      generatedAt: new Date().toISOString(),
      generalConclusion: generalConclusion,
      results: results
    };

  } catch (error: any) {
    console.error("Analysis Error:", error);
    throw new Error(`Erro na análise: ${error.message}`);
  }
};

/**
 * Chat function - requests specific format for citations
 */
export const chatWithTranscripts = async (
  apiKey: string,
  transcriptions: Transcription[],
  history: ChatMessage[],
  currentMessage: string
): Promise<string> => {
   const ai = new GoogleGenAI({ apiKey: apiKey });
   const model = "gemini-2.5-flash"; 

   try {
    const formattedHistory = history.map(h => `${h.role === 'user' ? 'Utilizador' : 'Assistente'}: ${h.text}`).join('\n');
    
    // Only send the last 15 messages
    const truncatedHistory = formattedHistory.split('\n').slice(-15).join('\n');

    const transcriptsContext = transcriptions.map(t => `
        <file name="${t.audioFileName}">
        ${t.fullText}
        </file>
    `).join('\n\n');

    const prompt = `
        BASE DE DADOS DE ÁUDIO (Múltiplas Testemunhas):
        ${transcriptsContext}

        HISTÓRICO RECENTE:
        ${truncatedHistory}

        PERGUNTA DO UTILIZADOR:
        ${currentMessage}
        
        INSTRUÇÕES DE RIGOR:
        1. **CONSULTA GLOBAL:** Tens de ler TODOS os ficheiros fornecidos acima. Não te limites ao primeiro. Se o utilizador perguntar "o que dizem os outros", procura ativamente nos outros ficheiros.
        2. **SEM ALUCINAÇÕES:** Se não sabes, diz "Não encontrei informação sobre isso nos áudios". NÃO inventes texto repetitivo (ex: "de de de").
        3. **RIGOR TEMÁTICO:** Responde APENAS ao que foi perguntado. Se perguntam sobre "pós-operatório", não fales do "pré-operatório".
        4. **FORMATO:** Usa APENAS a tag: [NomeDoFicheiro.mp3 @ MM:SS] para citar.
    `;

    const response = await ai.models.generateContent({
        model: model,
        contents: { parts: [{ text: prompt }] },
        config: {
          temperature: 0.1, // Lowered temperature to minimize hallucinations/loops
          safetySettings: [
            { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
            { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
            { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
            { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' }
          ]
        }
    });

    let finalText = response.text || "Sem resposta.";
    
    // Post-process to remove potential infinite loops generated by the model
    finalText = cleanRepetitiveLoops(finalText);
    
    // Safety check for massive repeated characters that regex might miss
    if (finalText.length > 500 && /^(.{1,5})\1{10,}/.test(finalText.slice(-100))) {
        finalText = "Erro: A IA gerou uma resposta repetitiva inválida. Por favor reformule a pergunta.";
    }

    return finalText;

   } catch (error) {
     console.error(error);
     return "Erro ao processar o chat.";
   }
};
