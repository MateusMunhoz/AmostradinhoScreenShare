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

# Fotos do tema Top Gun

Fundos do tema Top Gun (`styles-topgun.css`). Todas em **domínio público**: fotos de militares dos EUA em serviço
(obra do governo federal americano). Tiradas do Wikimedia Commons, reduzidas para até 1920 px de largura e convertidas
para WebP (qualidade 0,72; as duas maiores, F-16 e F-35C, com 1600 px e qualidade 0,6) pelo Chromium. O tom de visão
noturna é feito no CSS; a placa de dados de cada uma (avião, unidade, navio ou lugar, data e fotógrafo) fica em
`--tg-placa` no CSS, tirada da legenda oficial.

| Arquivo | Foto | Arquivo de origem no Commons | Licença lá |
|---|---|---|---|
| `topgun-catapulta.webp` | F-14 do VF-154 no lançamento, USS Kitty Hawk, 09/11/2002 (PH3 Todd Frantom, U.S. Navy) | `US Navy 021109-N-1810F-017 After burners on an F-14 Tomcat fire as the aircraft makes a cataputl launch.jpg` | Domínio público |
| `topgun-conves.webp` | F-14 do VF-213 no convés à noite, USS Theodore Roosevelt, 22/03/2003 (PH2 James K. McNeil, U.S. Navy) | `US Navy 030321-N-6895M-502 An F-14 Tomcat assigned to the.jpg` | Domínio público |
| `topgun-formacao.webp` | F-14B 201 e 202 do VF-11 em formação, 22/04/2004 (SSgt Aaron D. Allmon II, USAF) | `US Navy F-14B Tomcat (2268469404).jpg` | Domínio público |
| `topgun-mar.webp` | F-14D do VF-31 na aproximação, USS Theodore Roosevelt, 28/02/2006 (AN Nathan Laird, U.S. Navy) | `US Navy 060228-N-7241L-007 An F-14D Tomcat assigned to the.jpg` | Domínio público |
| `topgun-f22-silhueta.webp` | F-22 Raptor em silhueta, 25/11/2002 (Kevin Robertson, USAF) | `F-22 Raptor, silhouetted - 021105-O-9999G-073.jpg` | Domínio público |
| `topgun-f22-noite.webp` | F-22 do 433rd Weapons Squadron reabastecendo à noite, Nevada, 16/06/2016 (A1C Kevin Tanenbaum, USAF) | `F-22 Raptor is being refueled by a KC-135 Stratotanker over the Nevada Test and Training Range.jpg` | Domínio público |
| `topgun-superhornet.webp` | F/A-18F do VFA-211 no lançamento, USS Enterprise, 18/07/2007 (MCSN Brandon Morris, U.S. Navy) | `US Navy 070718-N-6524M-002 An F-A-18F Super Hornet, attached to the.jpg` | Domínio público |
| `topgun-f35-noite.webp` | F-35C nas primeiras operações noturnas no porta-aviões, USS Nimitz, 13/11/2014 (U.S. Navy) | `An F-35C Lightning II conducts night flight operations. (15628347079).jpg` | Domínio público |
| `topgun-f16.webp` | F-16 da 8th Tactical Fighter Wing soltando flare, Team Spirit '86 (A1C Perry Mecum, USAF) | `F-16 releases a flare.jpg` | Domínio público |

Foto nova: só foto marcada como domínio público no Commons. Entra aqui, em `TOPGUN_PHOTOS` (`renderer/configuracoes.js`),
num `data-foto` com a placa em `styles-topgun.css` e em `PACK_FILES` (`publicar.js`).