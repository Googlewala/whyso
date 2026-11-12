#!/usr/bin/env bash
set -u
B=http://localhost:12000
J='content-type: application/json'

echo "=== 1. UPI parse — dynamic merchant QR ==="
curl -s -X POST $B/api/upi/parse -H "$J" \
  -d '{"text":"upi://pay?pa=blinkit@ybl&pn=Blinkit&am=1450.00&cu=INR&tn=Groceries&tr=BLK123456&mc=5411&mode=02"}' | python3 -m json.tool

echo "=== 2. UPI parse — static QR (no amount) ==="
curl -s -X POST $B/api/upi/parse -H "$J" \
  -d '{"text":"upi://pay?pa=chai.theory@okaxis&pn=Chai%20Theory&cu=INR&mc=5814&mode=01"}' | python3 -m json.tool

echo "=== 3. UPI parse — EMVCo/Bharat QR TLV ==="
curl -s -X POST $B/api/upi/parse -H "$J" \
  -d '{"text":"0002010102120216IN.GOV.UPI0114merchant@ybl0208Cafe Co6304ABCD"}' | python3 -m json.tool

echo "=== 4. UPI parse — junk text ==="
curl -s -X POST $B/api/upi/parse -H "$J" -d '{"text":"hello world"}' | python3 -m json.tool

echo "=== 5. Build pay link ==="
curl -s -X POST $B/api/upi/link -H "$J" \
  -d '{"vpa":"diya.sharma@ybl","name":"Diya Sharma","amount":2500,"note":"Goa villa share"}' | python3 -m json.tool

echo "=== 6. Groups ==="
curl -s $B/api/groups | python3 -m json.tool

echo "=== 7. Group 1 ledger (splits + settlements) ==="
curl -s $B/api/groups/1 | python3 -c "import json,sys; d=json.load(sys.stdin); print('group:', d['group']['name'], '| total_spend:', d['total_spend']); print('balances:'); [print('  ', b['name'], 'paid', b['paid'], 'owed', b['owed'], 'settled', b['settled'], 'net', b['net']) for b in d['balances']]; print('suggested transfers:'); [print('  ', t['from']['name'], '->', t['to']['name'], t['amount']) for t in d['transfers']]"

echo "=== 8. Analytics summary ==="
curl -s "$B/api/analytics/summary" | python3 -c "
import json,sys
d=json.load(sys.stdin)
print('totals:', json.dumps(d['totals'], indent=2))
print('top categories:', [(c['name'], c['total'], str(c['pct'])+'%') for c in d['byCategory'][:5]])
print('months:', [(m['month'], m['total'], m['income']) for m in d['byMonth']])
print('forecast:', d['forecast'])
print('anomalies:', len(d['anomalies']))
for i in d['insights']: print(' insight:', i['type'], '-', i['title'])
print('budgets over 90%:', [(b['category'], b['pct']) for b in d['budgets'] if b['pct']>=90])
"

echo "=== 9. Occasions ==="
curl -s $B/api/occasions | python3 -c "
import json,sys
for o in json.load(sys.stdin):
  print(f\"  {o['title']}: budget {o['budget']} spent {o['spent']} ({o['pct']}%) days_left {o['days_left']} per-day {o['per_day_allowance']}\")"

echo "=== 10. SMS import (dry run) ==="
curl -s -X POST $B/api/import/sms -H "$J" -d '{"messages":[
 "Rs.1450.00 debited from A/c XX1234 to VPA blinkit@ybl (Blinkit) on 10-11-26. UPI Ref 416782345612.",
 "INR 3,299.00 spent on your ICICI Bank Card ending 4321 at AMAZON on 07-Nov-2026. Ref 998877665544.",
 "Rs 25,000.00 has been credited to A/c XX1234 from VPA employer.payroll@hdfcbank on 01-11-2026."
]}' | python3 -m json.tool

echo "=== 11. CSV import (dry run) ==="
curl -s -X POST $B/api/import/csv -H "$J" --data-binary @- <<'CSV' | python3 -c "import json,sys; d=json.load(sys.stdin); print('rows:', len(d['drafts'])); print(json.dumps(d['drafts'][:3], indent=2)); print('warnings:', d['warnings'])"
{"csv":"Date,Narration,Debit,Credit,Balance\n01/11/2026,UPI/DR/416782345612/blinkit@ybl/Blinkit,1450.00,,48250.00\n02/11/2026,UPI/DR/416782345613/swiggy@ybl/Swiggy Order,640.00,,47610.00\n03/11/2026,SALARY CREDIT EMPLOYER PAYROLL,,75000.00,122610.00\n"}
CSV
