#!/bin/sh
# Bundles index.html + game.js into one self-contained file you can just send.
set -e
out=${1:-readysteadybang.html}
python3 - "$out" <<'PY'
import sys
html = open('index.html').read()
js = open('game.js').read()
assert '<script src="game.js"></script>' in html, 'script tag not found'
html = html.replace('<script src="game.js"></script>',
                    '<script>\n' + js + '\n</script>')
open(sys.argv[1], 'w').write(html)
print(sys.argv[1], len(html) // 1024, 'KB')
PY
