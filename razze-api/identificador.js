'use strict';

// Identificador da conta: nome#1234 (docs/spec/identificador-nome-tag.md). O nome tem só letras sem acento e números
// (2 a 32), a tag é sorteada entre as livres daquele nome (0001 a 9999; 0000 é do sistema). Maiúsculas e minúsculas
// valem iguais para não repetir: a chave (handle_key) é o nome em minúsculas.
const { randomInt } = require('node:crypto');

const NOME_RE = /^[A-Za-z0-9]{2,32}$/;
const TAG_MAX = 9999;
// Ninguém se passa pela equipe: nem o nome exato nem começando com eles (admin2, suportenebula)
const RESERVADOS = ['admin', 'administrador', 'nebula', 'razze', 'suporte', 'sistema', 'moderador', 'moderacao', 'staff', 'equipe', 'telap2p'];
const IDENTIFICADOR_RE = /^([A-Za-z0-9]{2,32})#(\d{4})$/;

const reservado = (nome) => RESERVADOS.some((r) => nome.toLowerCase().startsWith(r));

// Erro de validação em texto para a pessoa; '' quando o nome serve
function problemaDoNome(nome) {
  if (typeof nome !== 'string' || !nome.trim()) return 'Escolha um nome para o identificador.';
  if (!/^[A-Za-z0-9]*$/.test(nome.trim())) return 'Use só letras sem acento e números, sem espaço.';
  if (!NOME_RE.test(nome.trim())) return 'O nome precisa ter de 2 a 32 letras ou números.';
  if (reservado(nome.trim())) return 'Esse nome é reservado. Escolha outro.';
  return '';
}

// Sugestão a partir de um nome qualquer (o de exibição, o do Google ou o e-mail): tira acento, espaço e símbolos
function sugerirNome(...fontes) {
  for (const fonte of fontes) {
    const limpo = String(fonte || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]/g, '').slice(0, 32);
    if (limpo.length >= 2 && !reservado(limpo)) return limpo;
  }
  return 'usuario';
}

// 'lucas#0420' -> { nome: 'lucas', tag: 420 }; texto que não é identificador -> null
function lerIdentificador(texto) {
  const m = IDENTIFICADOR_RE.exec(String(texto || '').trim());
  if (!m) return null;
  const tag = Number(m[2]);
  return tag >= 1 && tag <= TAG_MAX ? { nome: m[1], tag } : null;
}

const formatar = (nome, tag) => (nome && tag ? nome + '#' + String(tag).padStart(4, '0') : null);

// Tag livre para o nome (sorteio; quando o nome está quase lotado, procura a primeira livre). manterTag: a tag atual da
// pessoa, que fica se estiver livre no nome novo. ignorarId: a própria conta (trocar Lucas por lucas mantém a tag).
function tagLivre(db, chave, { manterTag = 0, ignorarId = '' } = {}) {
  const ocupada = db.prepare('SELECT 1 AS sim FROM users WHERE handle_key = ? AND handle_tag = ? AND id <> ?');
  if (manterTag && !ocupada.get(chave, manterTag, ignorarId)) return manterTag;
  for (let i = 0; i < 40; i++) {
    const tag = randomInt(1, TAG_MAX + 1);
    if (!ocupada.get(chave, tag, ignorarId)) return tag;
  }
  const usadas = new Set(db.prepare('SELECT handle_tag AS tag FROM users WHERE handle_key = ? AND id <> ?').all(chave, ignorarId).map((r) => r.tag));
  for (let tag = 1; tag <= TAG_MAX; tag++) if (!usadas.has(tag)) return tag;
  return 0;
}

module.exports = { problemaDoNome, sugerirNome, lerIdentificador, formatar, tagLivre, reservado, NOME_RE, TAG_MAX };
