
export const generateDocumentation = () => {
  const content = `
    <html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
    <head>
      <meta charset="utf-8">
      <title>Manual Veritas V2</title>
      <style>
        body { font-family: 'Calibri', 'Arial', sans-serif; line-height: 1.6; color: #1a202c; max-width: 800px; margin: auto; }
        h1 { color: #1e3a8a; border-bottom: 3px solid #3b82f6; padding-bottom: 10px; margin-top: 40px; font-size: 28pt; }
        h2 { color: #1d4ed8; margin-top: 30px; background-color: #eff6ff; padding: 10px; border-left: 5px solid #3b82f6; font-size: 18pt; }
        h3 { color: #475569; margin-top: 20px; font-size: 14pt; font-weight: bold; border-bottom: 1px solid #e2e8f0; }
        p { margin-bottom: 15px; text-align: justify; }
        ul { margin-bottom: 15px; }
        li { margin-bottom: 5px; }
        code { background-color: #f1f5f9; padding: 2px 5px; border-radius: 4px; font-family: 'Consolas', monospace; color: #c026d3; }
        pre { background-color: #1e293b; color: #f8fafc; padding: 15px; border-radius: 8px; overflow-x: auto; font-family: 'Consolas', monospace; }
        .toc { background-color: #f8fafc; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px; margin-bottom: 40px; }
        .toc a { text-decoration: none; color: #2563eb; display: block; margin-bottom: 5px; font-weight: 500; }
        .toc a:hover { text-decoration: underline; }
        .image-placeholder { 
            background-color: #e2e8f0; 
            border: 2px dashed #94a3b8; 
            color: #64748b; 
            padding: 40px; 
            text-align: center; 
            margin: 20px 0; 
            border-radius: 8px;
            font-weight: bold;
        }
        .note { background-color: #fef3c7; border-left: 4px solid #f59e0b; padding: 10px; margin: 10px 0; font-size: 0.9em; }
        .tech-tag { display: inline-block; background: #e0e7ff; color: #3730a3; padding: 2px 8px; rounded: 4px; font-size: 0.8em; font-weight: bold; margin-right: 5px; }
        .back-link { font-size: 0.8em; color: #94a3b8; text-decoration: none; display: block; margin-top: 10px; text-align: right; }
      </style>
    </head>
    <body>
      
      <h1>Veritas Audio Analyst V2</h1>
      <p><strong>Manual de Desenvolvimento, Utilização e Referência Técnica</strong></p>
      <p><em>Gerado automaticamente pela aplicação Veritas.</em></p>

      <div class="toc">
        <h2>Índice</h2>
        <a href="#intro">1. Introdução e Visão Geral</a>
        <a href="#development">2. O Caminho do Desenvolvimento</a>
        <a href="#user-manual">3. Manual do Utilizador (Tutorial)</a>
        <div style="padding-left: 20px;">
            <a href="#setup">3.1 Configuração Inicial</a>
            <a href="#import">3.2 Importação e Organização de Dados</a>
            <a href="#processing">3.3 Processamento com IA</a>
            <a href="#people">3.4 Gestão de Pessoas</a>
            <a href="#analysis">3.5 Relatórios Forenses</a>
            <a href="#chat">3.6 Assistente IA (Chatbot)</a>
            <a href="#viewer">3.7 Visualizador de Evidências</a>
        </div>
        <a href="#technical">4. Documentação Técnica</a>
        <div style="padding-left: 20px;">
            <a href="#tech-stack">4.1 Stack Tecnológica</a>
            <a href="#file-structure">4.2 Estrutura de Ficheiros</a>
            <a href="#core-algorithms">4.3 Algoritmos Principais</a>
        </div>
      </div>

      <!-- SECÇÃO 1 -->
      <h2 id="intro">1. Introdução e Visão Geral</h2>
      <p>O <strong>Veritas Audio Analyst V2</strong> é uma ferramenta web avançada desenhada para advogados, juízes e analistas forenses. O seu objetivo principal é transformar horas de gravações de áudio e centenas de páginas de autos em informação estruturada, pesquisável e acionável.</p>
      <p>Diferente de transcriptores comuns, o Veritas utiliza a tecnologia <strong>Google Gemini Pro 1.5/Flash</strong> para "ouvir" e "ler" provas, permitindo o cruzamento de dados (fact checking), a identificação automática de intervenientes e a navegação precisa no áudio através de uma interface estilo "Karaoke".</p>
      <a href="#top" class="back-link">Voltar ao Topo</a>

      <!-- SECÇÃO 2 -->
      <h2 id="development">2. O Caminho do Desenvolvimento</h2>
      <p>A construção desta aplicação seguiu um percurso iterativo focado na resolução de problemas específicos da análise forense. Abaixo descrevemos os principais desafios e as soluções implementadas.</p>

      <h3>2.1 O Desafio das Alucinações da IA</h3>
      <p>Inicialmente, os modelos de IA tendiam a inventar texto ou entrar em loops repetitivos ("de de de de...") ao transcrever áudios longos.</p>
      <p><strong>Solução:</strong> Implementou-se uma função de sanitização rigorosa (<code>sanitizeTranscript</code>). Esta função utiliza Expressões Regulares (Regex) para forçar quebras de linha antes de cada carimbo de tempo e remove padrões repetitivos. Além disso, os <em>prompts</em> do sistema foram blindados com instruções estritas para garantir uma fala por linha.</p>

      <h3>2.2 A Segurança do Browser e a Persistência</h3>
      <p>Os navegadores web modernos não permitem que um site guarde o caminho dos ficheiros do computador do utilizador por razões de segurança. Isso criava um problema: ao guardar um projeto e voltar no dia seguinte, os áudios deixavam de tocar.</p>
      <p><strong>Solução (Ficheiros Virtuais):</strong> Criou-se o conceito de "Ficheiro Virtual". Quando um projeto é carregado, o sistema restaura toda a inteligência (transcrições, análises), mas marca o ficheiro como "Virtual". O utilizador é então convidado a arrastar novamente os ficheiros originais para "re-hidratar" a ligação, restaurando o áudio sem perder o trabalho feito.</p>

      <h3>2.3 Interface Visual: "A Barra de Áudio"</h3>
      <p>No chat, respostas com muitas citações tornavam-se ilegíveis. O utilizador queria ver claramente de que ficheiro vinha a informação e ter acesso rápido aos vários momentos em que o assunto foi falado.</p>
      <p><strong>Solução (CitationGroup):</strong> Desenvolveu-se um componente visual que agrupa todas as citações do mesmo ficheiro num cartão azul. O rodapé desse cartão contém uma linha de botões interativos (ex: <code>02:50</code>, <code>05:10</code>), transformando a leitura numa experiência de navegação multimédia.</p>
      <a href="#top" class="back-link">Voltar ao Topo</a>

      <!-- SECÇÃO 3 -->
      <h2 id="user-manual">3. Manual do Utilizador</h2>

      <h3 id="setup">3.1 Configuração Inicial</h3>
      <p>Ao abrir a aplicação pela primeira vez, será recebido pelo ecrã de Autenticação.</p>
      <div class="image-placeholder">[IMAGEM: Ecrã de Login com chave API]</div>
      <p>Insira a sua chave API do Google Gemini. Se não tiver uma, clique no link fornecido para criar uma gratuitamente no Google AI Studio.</p>

      <h3 id="import">3.2 Importação e Organização de Dados</h3>
      <p>No separador <strong>DADOS</strong>, encontrará três áreas distintas:</p>
      <ul>
        <li><strong>Depoimentos:</strong> Para ficheiros de áudio (MP3, WAV) e transcrições.</li>
        <li><strong>Autos de Inquirição:</strong> Para PDFs oficiais.</li>
        <li><strong>Outros Documentos:</strong> Para anexos, fotos, etc.</li>
      </ul>
      <div class="image-placeholder">[IMAGEM: Grelha de Upload com as 3 categorias]</div>
      <p><strong>Funcionalidade Drag & Drop:</strong> Pode arrastar pastas inteiras do seu computador. A aplicação deteta a estrutura e organiza os ficheiros em "acordeões" (pastas expansíveis) para manter a interface limpa.</p>

      <h3 id="processing">3.3 Processamento com IA</h3>
      <p>Após carregar os ficheiros, clique no botão <strong>"Processar Tudo"</strong> ou nos botões individuais de "Play" em cada pasta. O sistema enviará os ficheiros para o Gemini para transcrição e extração de texto.</p>
      <div class="note">Nota: Se exceder a quota da Google, aparecerá um aviso amigável sugerindo uma pausa de 1 minuto.</div>

      <h3 id="people">3.4 Gestão de Pessoas</h3>
      <p>Pode adicionar pessoas manualmente ou usar a IA para as detetar. No Chat, quando pergunta "Quem participou?", a IA devolve uma lista e um botão <strong>"Adicionar à Lista"</strong> aparece. O sistema tenta associar automaticamente essas pessoas aos ficheiros de áudio correspondentes.</p>

      <h3 id="analysis">3.5 Relatórios Forenses</h3>
      <p>No separador <strong>RELATÓRIO</strong>, defina os "Factos a Provar" na aba de Dados e clique em "Gerar Relatório".</p>
      <div class="image-placeholder">[IMAGEM: Ecrã de Relatório com Factos e Conclusões]</div>
      <p>O relatório apresenta:</p>
      <ul>
        <li>Status (Confirmado/Desmentido).</li>
        <li>Resumo contextual (para documentos).</li>
        <li>Citações literais (para áudios) com botões de "Play".</li>
      </ul>
      <p>Pode editar o relatório, renomeá-lo e exportá-lo para Word.</p>

      <h3 id="chat">3.6 Assistente IA (Chatbot)</h3>
      <p>Faça perguntas em linguagem natural (ex: "O arguido confessou?"). A resposta incluirá cartões de evidência.</p>
      <div class="image-placeholder">[IMAGEM: Resposta do Chat com Barra de Áudio e Botões]</div>
      <ul>
        <li>Clique nos botões de tempo para ouvir o áudio.</li>
        <li>Clique no ícone de "Download" na mensagem para exportar essa conversa (incluindo os ficheiros originais num ZIP).</li>
      </ul>

      <h3 id="viewer">3.7 Visualizador de Evidências</h3>
      <p>Ao clicar num áudio, abre-se o Visualizador "Karaoke".</p>
      <div class="image-placeholder">[IMAGEM: Popup do Visualizador com Onda Sonora e Texto]</div>
      <ul>
        <li><strong>Sincronização:</strong> O texto rola automaticamente conforme o áudio toca.</li>
        <li><strong>Pesquisa:</strong> Use a barra no topo para encontrar palavras. Use as setas para saltar entre resultados.</li>
        <li><strong>Abrir Original:</strong> Clique no botão no canto superior direito para abrir o ficheiro original numa nova aba.</li>
      </ul>
      <a href="#top" class="back-link">Voltar ao Topo</a>

      <!-- SECÇÃO 4 -->
      <h2 id="technical">4. Documentação Técnica</h2>
      
      <h3 id="tech-stack">4.1 Stack Tecnológica</h3>
      <ul>
        <li><span class="tech-tag">Frontend</span> React 19 (Hooks, Functional Components)</li>
        <li><span class="tech-tag">Linguagem</span> TypeScript (Tipagem estrita para robustez)</li>
        <li><span class="tech-tag">Estilos</span> Tailwind CSS (Design responsivo e Dark Mode)</li>
        <li><span class="tech-tag">AI SDK</span> @google/genai (Gemini 2.5 Flash)</li>
        <li><span class="tech-tag">Utilitários</span> JSZip (Compressão), Lucide-React (Ícones)</li>
      </ul>

      <h3 id="file-structure">4.2 Estrutura de Ficheiros</h3>
      <pre>
/src
  ├── index.html           # Entry point, Tailwind config, Importmap
  ├── index.tsx            # React Root render
  ├── types.ts             # Definições de Tipos (EvidenceFile, ProjectState)
  ├── App.tsx              # Lógica Principal, Router, Gestão de Estado
  ├── services/
  │   └── geminiService.ts # Comunicação com API, Prompts, Sanitização Regex
  ├── components/
  │   ├── AudioPlayer.tsx  # (Deprecado/Integrado no EvidenceViewer)
  │   └── EvidenceViewer.tsx # Modal de visualização, Karaoke, Pesquisa
  └── utils/
      ├── exportService.ts # Geração de Word, ZIP, JSON
      └── documentationGenerator.ts # (Este ficheiro) Gerador de Manual
      </pre>

      <h3 id="core-algorithms">4.3 Algoritmos Principais</h3>
      
      <h4>Sanitização de Transcrição (geminiService.ts)</h4>
      <p>A função <code>sanitizeTranscript</code> é crítica. Ela recebe o texto bruto da IA e aplica Regex para garantir que cada carimbo de tempo <code>[MM:SS]</code> força uma quebra de linha <code>\n</code>. Isto é essencial para o componente de visualização saber qual linha destacar em cada segundo.</p>

      <h4>Agrupamento de Citações (App.tsx)</h4>
      <p>A função <code>renderMessageContent</code> analisa a resposta do chat. Se detetar múltiplas linhas consecutivas referindo o mesmo ficheiro (ex: bullets <code>*</code> com carimbos), ela não as desenha separadamente. Em vez disso, agrupa-as num objeto e passa-as ao componente <code>CitationGroup</code>, que desenha a "Barra de Áudio".</p>

      <h4>Reidratação de Ficheiros (App.tsx)</h4>
      <p>Ao carregar um JSON (<code>handleLoadProject</code>), os ficheiros vêm marcados como <code>isVirtual: true</code>. A função <code>addFiles</code> verifica se o nome do ficheiro novo corresponde a um virtual existente. Se sim, funde o objeto <code>File</code> real com os metadados existentes, restaurando a funcionalidade sem duplicar dados.</p>

      <hr />
      <p style="text-align: center; font-size: 0.8em; color: #999;">Documentação gerada automaticamente pelo Veritas Audio Analyst V2.</p>
    </body>
    </html>
  `;

  const blob = new Blob(['\ufeff', content], {
    type: 'application/msword'
  });

  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `Manual_Veritas_V2.doc`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};
