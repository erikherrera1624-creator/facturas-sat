// Lo ejecuta GitHub Actions antes de crear el instalador.
// Pone un numero de version nuevo en cada publicacion y guarda de que repositorio
// viene la app (para actualizaciones automaticas y la configuracion remota).
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const pkgPath = path.join(root, 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));

const [owner, repo] = (process.env.REPO || '').split('/');
if (!owner || !repo) throw new Error('Falta la variable REPO (usuario/repositorio).');

const [major, minor] = pkg.version.split('.');
pkg.version = `${major}.${minor}.${process.env.RUN_NUMBER || '0'}`;
pkg.build.publish = { ...pkg.build.publish, owner, repo };
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2));

fs.writeFileSync(
  path.join(root, 'build-info.json'),
  JSON.stringify({ repo: `${owner}/${repo}`, branch: process.env.BRANCH || 'main' }, null, 2)
);

console.log(`Version ${pkg.version} para ${owner}/${repo}`);
