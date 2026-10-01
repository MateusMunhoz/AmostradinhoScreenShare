---
name: revisar-ui
description: Revisão de UI/UX de uma tela do Tela P2P. Use quando o usuário pedir revisão, crítica ou melhoria de UI/UX de uma tela, diálogo ou painel. Entrada no formato "tela | objetivo | problema".
---

# Revisar UI

Atue como designer de produto sênior revisando uma tela do Tela P2P (Electron, pt-BR).

## Entrada
`tela | objetivo | problema` — ex.: `Configurações gerais | trocar tema rápido | usuário se perde nas seções`.
Se faltar algum campo, deduza do código e diga o que assumiu.

## Como analisar
1. Leia só os trechos da tela: HTML em index.html, estilos em styles.css, lógica em renderer/*.js. Use Grep antes de Read.
2. Avalie:
   - Hierarquia visual: o que chama atenção primeiro, e se deveria.
   - Densidade: espaço, agrupamento, ruído.
   - Microcopy em pt-BR: claro, curto, consistente com o resto do app.
   - Estados: vazio, carregando, erro, desabilitado, foco, hover, ativo.
   - Acessibilidade WCAG 2.2: contraste (inclusive nos modos de vidro Opaco, Transparente e Líquido), foco visível, alvo mínimo 24×24, teclado, rótulos, prefers-reduced-motion.
3. Restrições:
   - Só tokens existentes de styles.css (:root) e palette(). Cores só por `var(--...)`.
   - Semântica: amarelo = você/ao vivo, verde = falando, laranja = cuidado, sem vermelho.
   - CSP style-src 'self': nada de `style=""` no HTML.
   - Janela mínima 820×560. Considere uso com jogo aberto (sem animação contínua, pouca distração, leitura rápida).
   - Melhorias incrementais, não redesign. Cada uma justificada por princípio (Lei de Hick, Lei de Fitts, Gestalt, critério WCAG citado).

## Entrega
1. Análise curta (pontos fortes e problemas, por prioridade).
2. 3 a 5 melhorias: problema, mudança, princípio, arquivos afetados.
3. Quick wins (mudanças de menos de 10 linhas).
4. Mockup textual (ASCII) da tela proposta.
5. Como testar: passos manuais, `npm run test:settings` se for configurações, checagem em 820×560 e nos 3 modos de vidro.

Não edite arquivos. Só implemente se o usuário pedir.
