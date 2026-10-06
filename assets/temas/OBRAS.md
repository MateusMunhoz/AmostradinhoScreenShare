# Obras do tema Renascença

Fundos do tema Renascença (`styles-renascenca.css`). Todas em **domínio público** (pinturas com mais de 450 anos;
fotos fiéis de obras planas, sem moldura). Tiradas do Wikimedia Commons, reduzidas para 1920 px de largura e
convertidas para WebP (qualidade 0,72) pelo Chromium. O tom de verniz e o escurecimento são feitos no CSS.

| Arquivo | Obra | Arquivo de origem no Commons | Licença lá |
|---|---|---|---|
| `renascenca-atenas.webp` | Rafael, *A Escola de Atenas*, 1509–1511 | `La scuola di Atene.jpg` | Domínio público |
| `renascenca-anunciacao.webp` | Leonardo da Vinci, *A Anunciação*, c. 1472–1476 | `Leonardo da Vinci - Annunciazione - Google Art Project.jpg` | Domínio público |
| `renascenca-ceia.webp` | Leonardo da Vinci, *A Última Ceia*, 1495–1498 | `Última Cena - Da Vinci 5.jpg` | Domínio público |
| `renascenca-adao.webp` | Michelangelo, *A Criação de Adão*, c. 1512 | `Michelangelo - Creation of Adam (cropped).jpg` | Domínio público |

Obra nova: só foto marcada como domínio público no Commons (fotos com a moldura do museu costumam ser CC BY-SA do
fotógrafo; não servem). Entra aqui, em `RENAISSANCE_WORKS` (`renderer/configuracoes.js`), num `data-obra` com a etiqueta
em `styles-renascenca.css`, em `PACK_FILES` (`publicar.js`) e cabe no `assets/temas/*.webp` do `package.json`.

Fontes do tema: Cinzel e EB Garamond (licença SIL OFL, `assets/fontes/OFL-cinzel.txt` e `OFL-eb-garamond.txt`).

# Blueprints do tema Top Gun

Fundos do Início no tema Top Gun (`styles-topgun.css`): desenhos técnicos reais, do Wikimedia Commons, convertidos pelo
Chromium para WebP em verde (#39FF6A) sobre transparente (o preto vem do CSS). Nada foi redesenhado. Cortes (cutaway) e
míssil desmontado onde existe desenho livre. Só entram desenhos limpos e reais; Su-57, F-35, MiG-29 e AC-130 foram tirados por falta de desenho de boa qualidade. Dentro da sala o fundo é preto.

| Arquivo | Conteúdo | Origem no Commons | Licença lá |
|---|---|---|---|
| `topgun-bp-f16.webp` | F-16, corte da fuselagem (Cristian Ibarra Santillan) + AIM-9L | `General Dynamics F-16 Fighting Falcon cutaway drawing.jpg` | CC0 |
| `topgun-bp-f15.webp` | F-15, corte da fuselagem + AIM-9L | `McDonnell Douglas F-15 Eagle cutaway drawing.svg` | CC0 |
| `topgun-bp-a10.webp` | A-10, corte da fuselagem + AIM-9L | `Fairchild Republic A-10 Thunderbolt II cutaway.jpg` | Domínio público |
| `topgun-bp-f18.webp` | F/A-18, 3 vistas + AIM-9L | `McDonnell Douglas F-A-18 Hornet 3-view line drawing.png` | Domínio público |
| `topgun-bp-p38.webp` | P-38 Lightning, 3 vistas | `Lockheed P-38 Lightning 3-view.svg` | CC0 |
| `topgun-bp-hurricane.webp` | Hawker Hurricane, 3 vistas | `Hawker Hurricane 3-view.svg` | CC0 |
| `topgun-bp-mustang.webp` | P-51 Mustang (Mk III), 3 vistas | `Mustang Mk. III 3-view drawing.svg` | CC0 |
| `topgun-bp-lancaster.webp` | Avro Lancaster B.I, corte, c. 1943 (UK Ministry of Aircraft Production, via U.S. Office of War Information / National Archives; o desenho traz o aviso "Copyright The Aeroplane", mas o Commons o marca como domínio público) | `Avro Lancaster B.I cutaway drawing, circa 1943 (44266126).png` | Domínio público (Commons) |
| `topgun-bp-f22.webp` | F-22, 3 vistas | `Lockheed Martin F-22A Raptor 3-view.png` | CC BY-SA 2.0 |

O AIM-9L desmontado (`Breakout of the AIM-9L.svg`, domínio público, U.S. Navy) vai ao lado de F-16, F-15, A-10 e F/A-18.
Os desenhos clássicos (P-38, Hurricane, Mustang, Lancaster) vêm do Commons em alta resolução, viram verde sobre transparente
(a linha escura vira a opacidade), são recortados no desenho e reduzidos a 2000 px no lado maior (WebP 0,7). Cortes coloridos, pôsteres e
artes de marketing (Lockheed Martin, Airframe, revistas) **não** entram: têm direito autoral, e o app é distribuído em público.
Su-57 e AC-130 pedem crédito (a placa já cita). Desenho novo: só real e com licença livre; entra aqui, em `TOPGUN_PHOTOS`
(`renderer/configuracoes.js`), num `data-foto` com a placa em `styles-topgun.css` e em `PACK_FILES` (`publicar.js`).
