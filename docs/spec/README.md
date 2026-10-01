# Specs

Uma spec diz **o que** uma feature tem que fazer e **como saber que ficou pronta**, antes de implementar.
Não é obrigatória para tudo (veja o [fluxo](../fluxo-com-ia.md)).

| Precisa de spec? | Exemplos |
|---|---|
| Não | Bug, texto, ajuste visual, teste novo |
| Sim | Feature nova ou que muda comportamento em mais de uma parte (sala, voz, configurações...) |
| Sim, e talvez ADR | Muda arquitetura, protocolo da sala, segurança, `boot.js`, versão do Electron ou publicação |

## Como fazer
1. Copie [`_modelo.md`](_modelo.md) para `docs/spec/<nome-curto>.md` (ex.: `chat-criptografado.md`).
2. Preencha só o que fizer sentido. Não repita arquitetura: aponte para `docs/desenvolvimento.md`.
3. Linke a spec na issue e no PR. Itens do [roadmap](../roadmap.md) já têm objetivo e "Pronto quando": comece por eles.
4. Mudou o plano no meio? Atualize a spec no mesmo PR.

## Onde fica cada verdade
| Assunto | Fonte |
|---|---|
| O que o app é | [`README.md`](../../README.md) |
| Como o app se comporta hoje | [`docs/guia.md`](../guia.md) |
| O que vem por aí | [`docs/roadmap.md`](../roadmap.md) |
| Arquitetura, testes e publicação | [`docs/desenvolvimento.md`](../desenvolvimento.md) |
| Uma feature em construção | `docs/spec/<feature>.md` |

Decisão de arquitetura que precise ficar registrada (o porquê de uma escolha difícil de desfazer) vai em
`docs/adr/NNNN-titulo.md`, criada quando a primeira for necessária.
