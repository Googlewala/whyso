#!/usr/bin/env bash
set -u
B=http://localhost:12000

echo "=== ANALYTICS ==="
curl -s "$B/api/analytics/summary" | python3 -c "
import json,sys
d=json.load(sys.stdin)
print('totals:', json.dumps(d['totals']))
print('months:', [(m['month'], m['total'], m['income'], m['net']) for m in d['byMonth']])
print('forecast:', d['forecast'])
print('anomalies:', [(a['merchant'], a['amount'], a['category']) for a in d['anomalies']])
print('byPsp:', [(p['psp'], p['total']) for p in d['byPsp']])
print('byMethod:', [(m['method'], m['total']) for m in d['byMethod']])
for i in d['insights']: print(' insight:', i['type'], '-', i['title'])
"

echo "=== GROUP LEDGER (math check) ==="
curl -s $B/api/groups/1 | python3 -c "
import json,sys
d=json.load(sys.stdin)
print('total_spend:', d['total_spend'])
for b in d['balances']: print(' ', b['name'], 'paid', b['paid'], 'owed', b['owed'], 'net', b['net'])
for t in d['transfers']: print('  settle:', t['from']['name'], '->', t['to']['name'], t['amount'])
print('SUM of nets (must be ~0):', round(sum(b['net'] for b in d['balances']),2))
print('SUM of transfers:', round(sum(t['amount'] for t in d['transfers']),2))
"

echo "=== BUDGET RECOMMENDATIONS ==="
curl -s $B/api/analytics/budget-recommendations | python3 -c "import json,sys; print([(b['category'], b['avgMonthly'], b['suggested']) for b in json.load(sys.stdin)[:6]])"

echo "=== PAYEES (autocomplete) ==="
curl -s $B/api/upi/payees | python3 -c "import json,sys; print([(p['merchant'], p['vpa'], p['times']) for p in json.load(sys.stdin)[:6]])"

echo "=== CSV MERCHANT CLEANUP ==="
curl -s -X POST $B/api/import/csv -H 'content-type: application/json' -d '{"csv":"Date,Narration,Debit,Credit,Balance\n01/11/2026,UPI/DR/416782345612/blinkit@ybl/Blinkit,1450.00,,48250.00\n02/11/2026,POS 4321XX AMAZON PAY INDIA,3299.00,,44951.00\n"}' | python3 -c "
import json,sys
for r in json.load(sys.stdin)['drafts']: print(' ', repr(r['merchant']), '| vpa:', r['vpa'], '| amt:', r['amount'], '| dir:', r['direction'])
"

echo "=== PDF STATEMENT ==="
curl -s -o /tmp/statement.pdf -w "HTTP %{http_code} | %{size_download} bytes | %{content_type}\n" "$B/api/statement.pdf?from=2026-09-01&to=2026-11-30"
file /tmp/statement.pdf
python3 -c "
import re
data=open('/tmp/statement.pdf','rb').read()
print('pages:', len(re.findall(rb'/Type\s*/Page[^s]', data)))
print('has EOF marker:', data.rstrip().endswith(b'%%EOF'))
"

echo "=== PDF (group-only statement) ==="
curl -s -o /tmp/statement-goa.pdf -w "HTTP %{http_code} | %{size_download} bytes\n" "$B/api/statement.pdf?group_id=1"

echo "=== QR PNG ==="
curl -s -o /tmp/qr.png -w "HTTP %{http_code} | %{size_download} bytes | %{content_type}\n" "$B/qr.png?vpa=diya.sharma@ybl&name=Diya%20Sharma&amount=2500&note=Goa%20villa"
file /tmp/qr.png
