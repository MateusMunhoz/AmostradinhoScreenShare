@AGENTS.md

## Só para o Claude Code
- Regras por pasta em `.claude/rules/` carregam sozinhas; skills em `.claude/skills/` quando a tarefa pedir.
- Investigação ampla: agente Explore. Mudança em área crítica (lista em AGENTS.md): modo plano antes de editar.
- Grep antes de Read; em arquivo grande, leia com offset/limit. Não releia arquivo que acabou de editar.
- Responder direto, sem enrolação.
- Preferências pessoais vão em `.claude/settings.local.json` ou `CLAUDE.local.md` (fora do Git), nunca aqui.
