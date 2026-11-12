#!/usr/bin/env bash
set -u
B=http://localhost:12000
J='content-type: application/json'

echo "=== POST expense (auto-category from merchant) ==="
curl -s -X POST $B/api/expenses -H "$J" \
  -d '{"amount":"1,299.50","merchant":"Swiggy Instamart","note":"weekly groceries","vpa":"swiggy@ybl","occurred_at":"2026-11-12T14:30:00"}' \
  | python3 -c "import json,sys; e=json.load(sys.stdin)['expense']; print(' id',e['id'],'| cat',e['category'],e['category_icon'],'| amt',e['amount'],'| method',e['method'])"

echo "=== POST expense with exact split into group 1 ==="
curl -s -X POST $B/api/expenses -H "$J" \
  -d '{"amount":4000,"merchant":"Beach Shack","group_id":1,"split_mode":"exact","occurred_at":"2026-11-12T20:00:00","participants":[{"user_id":1,"value":1000},{"user_id":2,"value":1000},{"user_id":3,"value":1000},{"user_id":4,"value":1000}]}' \
  | python3 -c "import json,sys; e=json.load(sys.stdin)['expense']; print(' id',e['id'],'| group',e['group_name'],'| amt',e['amount'])"

echo "=== exact split that does NOT balance (should be rejected) ==="
curl -s -X POST $B/api/expenses -H "$J" \
  -d '{"amount":4000,"merchant":"Bad Split","group_id":1,"split_mode":"exact","participants":[{"user_id":1,"value":1000},{"user_id":2,"value":1000}]}' \
  | python3 -m json.tool

echo "=== POST group with members ==="
curl -s -X POST $B/api/groups -H "$J" -d '{"name":"Office Lunch Club","emoji":"🍱","kind":"team","member_ids":[2,3,4,5]}' \
  | python3 -c "import json,sys; g=json.load(sys.stdin)['group']; print(' group', g['id'], g['name'])"

echo "=== POST settlement + UPI pay link ==="
curl -s -X POST $B/api/groups/1/settle -H "$J" -d '{"from_user":3,"to_user":2,"amount":1000,"note":"Goa partial"}' \
  | python3 -c "import json,sys; d=json.load(sys.stdin); print(' settlement id', d['settlement']['id']); print(' pay_link:', d['pay_link'])"

echo "=== POST occasion ==="
curl -s -X POST $B/api/occasions -H "$J" -d '{"title":"Bike Purchase","type":"goal","date":"2027-06-01","budget":150000,"color":"#0ea5e9","notes":"Save 25k/month"}' \
  | python3 -c "import json,sys; o=json.load(sys.stdin)['occasion']; print(' occasion', o['id'], o['title'], '| days_left', o['days_left'], '| per-day', o['per_day_allowance'])"

echo "=== PUT budgets (upsert) ==="
curl -s -X PUT $B/api/budgets -H "$J" -d '{"items":[{"category_id":2,"amount":9000},{"category_id":4,"amount":6000}]}' \
  | python3 -c "import json,sys; print([(b['category'], b['amount']) for b in json.load(sys.stdin)])"

echo "=== PUT expense ==="
curl -s -X PUT $B/api/expenses/1 -H "$J" -d '{"note":"edited note","amount":1500}' \
  | python3 -c "import json,sys; e=json.load(sys.stdin)['expense']; print(' id',e['id'],'| note',e['note'],'| amt',e['amount'])"

echo "=== GET expenses filters ==="
curl -s "$B/api/expenses?method=upi&limit=5" | python3 -c "import json,sys; d=json.load(sys.stdin); print(' total',d['total'],'| spend',d['spend'],'| first',[(r['merchant'],r['method']) for r in d['rows'][:3]])"

echo "=== invalid amount rejected ==="
curl -s -X POST $B/api/expenses -H "$J" -d '{"amount":"abc","merchant":"X"}' | python3 -m json.tool

echo "=== DELETE test expense ==="
curl -s -X DELETE $B/api/expenses/53 | python3 -m json.tool
