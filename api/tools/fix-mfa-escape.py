# -*- coding: utf-8 -*-
import io
s = io.open('src/routes.mjs', encoding='utf-8').read()
bad = "await q(\x60UPDATE admin_user SET \x24{col} = ?, mfa_channel = ?, mfa_enabled = 1 WHERE id = ?\x60, [target, channel, userId])"
if bad in s:
    s = s.replace(bad, "await q('UPDATE admin_user SET ' + col + ' = ?, mfa_channel = ?, mfa_enabled = 1 WHERE id = ?', [target, channel, userId])")
    print('escaped literal fixed')
else:
    # 兜底：按行定位重写
    lines = s.split(chr(10))
    for i, ln in enumerate(lines):
        if 'mfa_channel = ?, mfa_enabled = 1 WHERE id = ?' in ln and 'col' in ln:
            lines[i] = "    await q('UPDATE admin_user SET ' + col + ' = ?, mfa_channel = ?, mfa_enabled = 1 WHERE id = ?', [target, channel, userId])"
            print('line', i + 1, 'rewritten')
    s = chr(10).join(lines)
io.open('src/routes.mjs', 'w', encoding='utf-8', newline=chr(10)).write(s)
