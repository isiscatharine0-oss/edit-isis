'use strict';
// Normalização para evitar profissionais duplicados.

const TITLES = /\b(dra?|dr|doutora?|doutor|prof|profa|professora?)\b\.?/g;

function normalizeName(name) {
  return String(name || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(TITLES, ' ')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeCity(city) {
  return normalizeName(city).replace(/\b(ba|bahia)\b/g, '').trim();
}

function normalizeInstagram(v) {
  if (!v) return null;
  let s = String(v).trim().toLowerCase();
  s = s.replace(/^https?:\/\/(www\.)?instagram\.com\//, '').replace(/^@/, '');
  s = s.split(/[/?#]/)[0];
  return s || null;
}

function normalizeDomain(url) {
  if (!url) return null;
  try {
    const u = new URL(/^https?:/.test(url) ? url : `https://${url}`);
    return u.hostname.replace(/^www\./, '').toLowerCase();
  } catch { return null; }
}

function normalizeRegistry(r) {
  if (!r) return null;
  return String(r).toUpperCase().replace(/[^A-Z0-9]/g, '') || null;
}

/** Procura um lead existente que represente o mesmo profissional. */
function findDuplicate(db, lead) {
  const ig = normalizeInstagram(lead.instagram);
  if (ig) {
    const r = db.prepare('SELECT * FROM lead WHERE instagram = ?').get(ig);
    if (r) return { lead: r, reason: 'mesmo Instagram' };
  }
  const reg = normalizeRegistry(lead.registry);
  if (reg) {
    const r = db.prepare('SELECT * FROM lead WHERE registry = ?').get(reg);
    if (r) return { lead: r, reason: 'mesmo registro profissional' };
  }
  const dom = normalizeDomain(lead.website);
  if (dom) {
    const rows = db.prepare('SELECT * FROM lead WHERE website IS NOT NULL').all();
    const r = rows.find((x) => normalizeDomain(x.website) === dom && normalizeName(x.name) === normalizeName(lead.name));
    if (r) return { lead: r, reason: 'mesmo site e nome' };
  }
  const n = normalizeName(lead.name);
  if (n) {
    const rows = db.prepare('SELECT * FROM lead WHERE dedup_name = ?').all(n);
    const city = normalizeCity(lead.city);
    const r = rows.find((x) => !city || !x.city || normalizeCity(x.city) === city);
    if (r) return { lead: r, reason: 'mesmo nome na mesma cidade' };
  }
  return null;
}

module.exports = { normalizeName, normalizeCity, normalizeInstagram, normalizeDomain, normalizeRegistry, findDuplicate };
