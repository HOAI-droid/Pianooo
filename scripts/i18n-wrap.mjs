// ── One-off codemod: wrap visible UI texts in t`…` ───────────────────────────
// Finds JSX text (<span>Library</span>) and the attributes people read
// (title, placeholder, aria-label) in src/**/*.tsx and wraps them in t`…`,
// adding the import where needed. Leaves code, numbers, symbols, entities and
// anything already translated alone. Run: node scripts/i18n-wrap.mjs [--dry]
import ts from 'typescript'
import fs from 'node:fs'
import path from 'node:path'

const DRY = process.argv.includes('--dry')
const ATTRS = new Set(['title', 'placeholder', 'aria-label'])
const SKIP_DIRS = ['src/platform']

const files = fs.readdirSync('src', { recursive: true })
  .filter(f => f.endsWith('.tsx') && !/Test\.tsx$/.test(f))
  .map(f => path.join('src', f))
  .filter(f => !SKIP_DIRS.some(d => f.startsWith(d)))
  // drawn lettering, not text: logo and title marks
  .filter(f => !/(OrfeoLogo|Mark)\.tsx$/.test(f))

const hasLetters = s => /\p{L}{2,}/u.test(s)
const escapeTpl = s => s.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${')

let total = 0
for (const file of files) {
  const src = fs.readFileSync(file, 'utf8')
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const edits = []
  const visit = (n) => {
    if (n.kind === ts.SyntaxKind.JsxText) {
      const raw = n.getFullText(sf)
      const trimmed = raw.trim()
      if (trimmed && hasLetters(trimmed) && !/[{}<>]|&[#\w]+;/.test(trimmed)) {
        const start = n.getFullStart() + raw.indexOf(trimmed)
        const text = trimmed.replace(/\s*\n\s*/g, ' ')
        edits.push({ start, end: start + trimmed.length, text: `{t\`${escapeTpl(text)}\`}` })
      }
    } else if (ts.isJsxAttribute(n) && ATTRS.has(n.name.getText(sf)) && n.initializer && ts.isStringLiteral(n.initializer)) {
      const v = n.initializer.text
      if (hasLetters(v)) edits.push({ start: n.initializer.getStart(sf), end: n.initializer.end, text: `{t\`${escapeTpl(v)}\`}` })
    }
    ts.forEachChild(n, visit)
  }
  visit(sf)
  if (!edits.length) continue
  let out = src
  for (const e of edits.sort((a, b) => b.start - a.start)) out = out.slice(0, e.start) + e.text + out.slice(e.end)
  // import { t } where missing
  if (!/import\s*\{[^}]*\bt\b[^}]*\}\s*from\s*['"][./]+(?:\.\.\/)*utils\/i18n['"]/.test(out)) {
    const rel = path.relative(path.dirname(file), 'src/utils/i18n').split(path.sep).join('/')
    const spec = rel.startsWith('.') ? rel : './' + rel
    const imports = [...out.matchAll(/^import .*$/gm)]
    const at = imports.length ? imports[imports.length - 1].index + imports[imports.length - 1][0].length : 0
    out = out.slice(0, at) + `\nimport { t } from '${spec}'` + out.slice(at)
  }
  total += edits.length
  console.log(`${file}: ${edits.length}`)
  if (!DRY) fs.writeFileSync(file, out)
}
console.log(`${total} texts wrapped`)
