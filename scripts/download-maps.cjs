// Public administrative boundary data. Keep downloaded files local for browsing.
const fs = require('node:fs/promises');
const path = require('node:path');
const root = path.resolve(__dirname, '../data/maps');
const base = 'https://geo.datav.aliyun.com/areas_v3/bound/';
async function load(code) {
  const file = path.join(root, `${code}.json`);
  try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch {}
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(`${base}${code}_full.json`, { signal: AbortSignal.timeout(20000) });
      if (!res.ok) { if (res.status === 404) return null; throw Error(res.status); }
      const data = await res.json();
      await fs.writeFile(file, JSON.stringify(data));
      return data;
    } catch (e) { if (attempt === 2) { console.log('Unavailable', code, e.message); return null; } }
  }
}
async function pool(items, fn) {
  let cursor = 0;
  await Promise.all(Array.from({length: 8}, async () => { while (cursor < items.length) await fn(items[cursor++]); }));
}
(async () => {
  await fs.mkdir(root, { recursive: true });
  const national = await load('100000');
  if (!national) throw Error('National map unavailable');
  const cities = [];
  await pool(national.features.filter(f => f.properties.name && /^\d{6}$/.test(f.properties.adcode)), async province => {
    const p = province.properties;
    const data = await load(p.adcode);
    if (!data) { cities.push({...p, province: p.name, direct: true, outline: province}); return; }
    if (data.features.some(f => f.properties.level === 'city')) {
      for (const f of data.features) if (f.properties.name) cities.push({...f.properties, province: p.name, outline: f});
    } else cities.push({...p, province: p.name, direct: true, outline: province});
  });
  await fs.writeFile(path.join(root, 'cities.json'), JSON.stringify(cities));
  console.log('City index:', cities.length);
  await pool(cities.filter(c => !c.direct), c => load(c.adcode));
  console.log('Map download complete. Files:', (await fs.readdir(root)).length);
})();
