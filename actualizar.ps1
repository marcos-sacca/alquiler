# Relevamiento diario desde esta PC (Zonaprop bloquea a los servidores de GitHub) y subida a GitHub Pages.
Set-Location $PSScriptRoot
node tracker.mjs --diario
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
git add data data.js
git diff --cached --quiet
if ($LASTEXITCODE -ne 0) {
    git commit -q -m "Datos $(Get-Date -Format yyyy-MM-dd)"
    git push -q
}
