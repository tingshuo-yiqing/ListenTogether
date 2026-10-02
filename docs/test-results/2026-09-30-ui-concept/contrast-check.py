"""从原型 CSS 读取最终语义色，检查文字、头像与输入边界；只用标准库。"""
from pathlib import Path
import json
import re

HERE = Path(__file__).resolve().parent
SOURCE = HERE.parents[2] / 'docs/ui-prototype/styles.css'


def luminance(color):
    values = [int(color[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    values = [v / 12.92 if v <= .04045 else ((v + .055) / 1.055) ** 2.4 for v in values]
    return sum(v * weight for v, weight in zip(values, (.2126, .7152, .0722)))


def contrast(foreground, background):
    high, low = sorted([luminance(foreground), luminance(background)], reverse=True)
    return (high + .05) / (low + .05)


css = SOURCE.read_text(encoding='utf-8')
light, rest = css.split('body[data-theme="dark"]', 1)
dark = rest.split('body[data-text', 1)[0]
pairs = [('--ink', '--paper'), ('--ink', '--surface'), ('--muted', '--surface'),
         ('--muted', '--surface-soft'), ('--muted', '--accent-soft'), ('--on-primary', '--primary'),
         ('--error', '--error-surface'), ('--warning', '--warning-surface'),
         ('--player-muted', '--player-bg'), ('--ink', '--accent-soft')]
result = {}
for name, rules in [('light', light), ('dark', dark)]:
    tokens = dict(re.findall(r'(--[\w-]+):\s*(#[0-9a-fA-F]{6})', rules))
    checks = [(fg, bg, 4.5) for fg, bg in pairs]
    checks += [('--border-strong', bg, 3) for bg in ('--surface', '--surface-soft')]
    checks += [('#263c35' if name == 'light' else '#20352a', bg, 4.5)
               for bg in ('--sage', '--sand', '--rose', '--blue')]
    result[name] = []
    for fg, bg, minimum in checks:
        measured = contrast(tokens.get(fg, fg), tokens[bg])
        result[name].append({'foreground': fg, 'background': bg, 'ratio': round(measured, 2),
                             'minimum': minimum, 'passed': measured >= minimum})
(HERE / 'contrast-results.json').write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8')
all_checks = [check for theme in result.values() for check in theme]
print(f'Contrast: {sum(check["passed"] for check in all_checks)}/{len(all_checks)} passed')
for check in all_checks:
    if not check['passed']:
        print(check)
raise SystemExit(0 if all(check['passed'] for check in all_checks) else 1)
