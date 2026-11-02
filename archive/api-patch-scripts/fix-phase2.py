# -*- coding: utf-8 -*-
import io
s = io.open('test/e2e-phase2.mjs', encoding='utf-8').read()
old = "SELECT 'WLPH2-' + FLOOR(RAND()*100000), ?, 1, 1, '310118', 1, 1, 2000000, 2000000, 50, 'p-ph2', NOW(), NOW()"
new = "SELECT CONCAT('WLPH2-', FLOOR(RAND()*100000)), ?, 1, 1, '310118', 1, 1, 2000000, 2000000, 50, 'p-ph2', NOW(), NOW()"
assert old in s
s = s.replace(old, new)
io.open('test/e2e-phase2.mjs', 'w', encoding='utf-8', newline='\n').write(s)
print('fixed CONCAT')
