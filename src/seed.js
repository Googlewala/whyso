import { all, get, initSchema, run, tx } from './db.js';
import { computeShares } from './split.js';
import { categoryFromMcc } from './upi.js';

const CATEGORIES = [
  ['Groceries', '🛒', '#22c55e', 'bigbasket,blinkit,zepto,dmart,reliance fresh,more,supermarket,kirana,grocery,instamart'],
  ['Dining', '🍽️', '#f97316', 'swiggy,zomato,restaurant,cafe,dominos,pizza,bar,chai,coffee,hotel,starbucks,faasos,blinkit cafe'],
  ['Transport', '🚕', '#3b82f6', 'uber,ola,rapido,metro,auto,taxi,irctc,train,bus,redbus,blablacar'],
  ['Fuel', '⛽', '#eab308', 'petrol,hp,indianoil,bharat petroleum,shell,fuel,petroleum,hpcl,iocl,bpcl'],
  ['Shopping', '🛍️', '#ec4899', 'amazon,flipkart,myntra,ajio,meesho,nykaa,decathlon,store,mall,shopping,lifestyle'],
  ['Bills', '🧾', '#8b5cf6', 'electricity,airtel,jio,vi,bsnl,broadband,dth,tata power,recharge,gas,water bill,billdesk'],
  ['Rent', '🏠', '#0ea5e9', 'rent,landlord,maintenance,mygate,nobroker'],
  ['Health', '💊', '#ef4444', 'pharmacy,apollo,medplus,netmeds,1mg,pharmeasy,hospital,clinic,doctor,lab,diagnostic,practo'],
  ['Entertainment', '🎬', '#a855f7', 'netflix,prime,hotstar,spotify,bookmyshow,pvr,inox,game,steam,sonyliv,jiocinema'],
  ['Education', '📚', '#14b8a6', 'udemy,coursera,byju,unacademy,school,college,tuition,books,exam,fee'],
  ['Travel', '✈️', '#f43f5e', 'makemytrip,goibibo,oyo,airbnb,indigo,air india,hotel booking,visa,cleartrip'],
  ['Investments', '📈', '#10b981', 'zerodha,groww,upstox,mutual fund,sip,nps,ppf,coin,kuvera,smallcase'],
  ['Transfers', '🔁', '#64748b', 'transfer,self,sent to,received from,imps,neft'],
  ['Cash', '💵', '#84cc16', 'atm,cash withdrawal,cash'],
  ['Software', '🧑‍💻', '#6366f1', 'google one,icloud,openai,adobe,github,aws,vercel,digitalocean,subscription'],
];

const USERS = [
  { name: 'Aarav Mehta', vpa: 'aarav.mehta@okhdfcbank' },
  { name: 'Diya Sharma', vpa: 'diya.sharma@ybl' },
  { name: 'Rohan Iyer', vpa: 'rohan.iyer@okaxis' },
  { name: 'Priya Nair', vpa: 'priya.nair@paytm' },
  { name: 'Kabir Singh', vpa: 'kabir.singh@ibl' },
];

const EXPENSE_TEMPLATES = [
  ['Groceries', 'BigBasket', 'bigbasket@ybl', 'bigbasket', 1840, 'debit', 'upi', '2026-09-03 19:20:00'],
  ['Dining', 'Swiggy', 'swiggy@ybl', 'swiggy', 640, 'debit', 'upi', '2026-09-04 13:05:00'],
  ['Transport', 'Uber', 'uber@axisbank', 'uber', 318, 'debit', 'upi', '2026-09-05 09:12:00'],
  ['Fuel', 'Indian Oil', 'indianoil@icici', 'petrol pump', 2450, 'debit', 'card', '2026-09-06 08:30:00'],
  ['Shopping', 'Amazon', 'amazon@apl', 'amazon', 3299, 'debit', 'card', '2026-09-07 21:45:00'],
  ['Bills', 'Airtel', 'airtel@axisbank', 'airtel postpaid', 999, 'debit', 'upi', '2026-09-08 07:00:00'],
  ['Rent', 'Landlord', 'landlord@okhdfcbank', 'house rent', 24000, 'debit', 'imps', '2026-09-01 10:00:00'],
  ['Health', 'Apollo Pharmacy', 'apollopharmacy@ybl', 'medicine', 742, 'debit', 'upi', '2026-09-09 18:40:00'],
  ['Entertainment', 'Netflix', 'netflix@axl', 'netflix subscription', 649, 'debit', 'card', '2026-09-10 06:00:00'],
  ['Travel', 'MakeMyTrip', 'makemytrip@ibl', 'flight booking', 7450, 'debit', 'card', '2026-09-11 22:10:00'],
  ['Dining', 'Zomato', 'zomato@paytm', 'dinner order', 880, 'debit', 'upi', '2026-09-12 20:15:00'],
  ['Groceries', 'Zepto', 'zepto@ybl', 'zepto instant', 512, 'debit', 'upi', '2026-09-13 08:05:00'],
  ['Transport', 'Ola', 'ola@axisbank', 'cab office', 276, 'debit', 'upi', '2026-09-14 09:50:00'],
  ['Software', 'OpenAI', 'openai@apl', 'chatgpt plus', 1999, 'debit', 'card', '2026-09-15 05:30:00'],
  ['Bills', 'Tata Power', 'tatapower@icici', 'electricity bill', 2340, 'debit', 'upi', '2026-09-16 11:20:00'],
  ['Investments', 'Groww', 'groww@ybl', 'sip transfer', 10000, 'debit', 'neft', '2026-09-17 09:00:00'],
  ['Dining', 'Starbucks', 'starbucks@axl', 'coffee', 420, 'debit', 'card', '2026-10-01 17:30:00'],
  ['Groceries', 'Blinkit', 'blinkit@ybl', 'weekly groceries', 1620, 'debit', 'upi', '2026-10-02 19:00:00'],
  ['Transport', 'Rapido', 'rapido@ibl', 'bike ride', 96, 'debit', 'upi', '2026-10-03 08:45:00'],
  ['Shopping', 'Myntra', 'myntra@apl', 'festive clothes', 4590, 'debit', 'card', '2026-10-04 22:05:00'],
  ['Entertainment', 'BookMyShow', 'bookmyshow@paytm', 'movie tickets', 900, 'debit', 'upi', '2026-10-05 19:40:00'],
  ['Health', 'Practo', 'practo@ybl', 'doctor consult', 800, 'debit', 'upi', '2026-10-06 10:30:00'],
  ['Bills', 'Jio', 'jio@axisbank', 'jio fibre', 1499, 'debit', 'upi', '2026-10-07 07:15:00'],
  ['Dining', 'Dominos', 'dominos@icici', 'pizza night', 745, 'debit', 'card', '2026-10-08 21:00:00'],
  ['Fuel', 'HP Petrol', 'hpcl@ibl', 'petrol', 2100, 'debit', 'card', '2026-10-09 08:20:00'],
  ['Groceries', 'DMart', 'dmart@ybl', 'monthly stock', 3870, 'debit', 'card', '2026-10-10 18:00:00'],
  ['Travel', 'OYO', 'oyo@paytm', 'weekend stay', 3200, 'debit', 'upi', '2026-10-11 15:30:00'],
  ['Education', 'Coursera', 'coursera@apl', 'course fee', 3999, 'debit', 'card', '2026-10-12 12:00:00'],
  ['Dining', 'Chai Point', 'chaipoint@ybl', 'office chai', 260, 'debit', 'upi', '2026-11-01 16:20:00'],
  ['Groceries', 'Instamart', 'instamart@ybl', 'groceries', 1450, 'debit', 'upi', '2026-11-02 19:45:00'],
  ['Transport', 'Uber', 'uber@axisbank', 'airport drop', 780, 'debit', 'upi', '2026-11-03 05:10:00'],
  ['Bills', 'Airtel', 'airtel@axisbank', 'airtel postpaid', 999, 'debit', 'upi', '2026-11-04 07:00:00'],
  ['Shopping', 'Flipkart', 'flipkart@apl', 'diwali gifts', 5240, 'debit', 'card', '2026-11-05 22:30:00'],
  ['Dining', 'Swiggy', 'swiggy@ybl', 'team lunch', 1290, 'debit', 'upi', '2026-11-06 13:30:00'],
  ['Entertainment', 'PVR', 'pvr@ibl', 'movie with family', 1180, 'debit', 'card', '2026-11-07 20:00:00'],
  ['Health', 'MedPlus', 'medplus@ybl', 'monthly medicines', 640, 'debit', 'upi', '2026-11-08 18:10:00'],
  ['Software', 'GitHub', 'github@apl', 'copilot', 850, 'debit', 'card', '2026-11-09 04:00:00'],
  ['Fuel', 'Shell', 'shell@icici', 'diesel', 3100, 'debit', 'card', '2026-11-10 08:05:00'],
  ['Groceries', 'Reliance Fresh', 'relianceretail@ybl', 'vegetables', 980, 'debit', 'upi', '2026-11-11 18:50:00'],
  ['Dining', 'Zomato', 'zomato@paytm', 'lunch order', 470, 'debit', 'upi', '2026-11-12 13:15:00'],
];

function categoryByName(name) {
  return get(`SELECT * FROM categories WHERE name = :n`, { n: name });
}

export function inferCategory(text, mcc) {
  const mapped = mcc ? categoryFromMcc(mcc) : null;
  if (mapped) {
    const c = categoryByName(mapped);
    if (c) return c;
  }
  const hay = String(text || '').toLowerCase();
  const cats = all(`SELECT * FROM categories`);
  let best = null;
  let bestScore = 0;
  for (const c of cats) {
    for (const kw of c.keywords.split(',').map((s) => s.trim()).filter(Boolean)) {
      if (hay.includes(kw) && kw.length > bestScore) {
        best = c;
        bestScore = kw.length;
      }
    }
  }
  if (best) return best;
  return categoryByName('Transfers') || cats[0];
}

export function seedIfEmpty() {
  initSchema();
  const count = get(`SELECT COUNT(*) c FROM users`).c;
  if (count > 0) return { seeded: false };

  return tx(() => {
    for (const [name, icon, color, keywords] of CATEGORIES) {
      run(
        `INSERT OR IGNORE INTO categories (name, icon, color, keywords) VALUES (:name, :icon, :color, :keywords)`,
        { name, icon, color, keywords },
      );
    }

    const userIds = USERS.map((u) => {
      const r = run(`INSERT INTO users (name, vpa) VALUES (:name, :vpa)`, u);
      return Number(r.lastInsertRowid);
    });
    const [aarav, diya, rohan, priya, kabir] = userIds;

    for (const uid of userIds) {
      run(`INSERT INTO accounts (user_id, name, type, vpa, opening_balance) VALUES (:u, :n, 'bank', :v, 25000)`, {
        u: uid, n: 'Primary Savings', v: USERS[userIds.indexOf(uid)].vpa,
      });
    }
    const account = get(`SELECT id FROM accounts WHERE user_id = :u`, { u: aarav }).id;

    // ---- Groups ----
    const groups = [
      { name: 'Goa Trip 2026', emoji: '🏝️', kind: 'trip', members: [aarav, diya, rohan, priya], owner: aarav },
      { name: 'Flat 402 — Rent & Bills', emoji: '🏠', kind: 'household', members: [aarav, rohan, kabir], owner: aarav },
      { name: 'Diwali Squad', emoji: '🪔', kind: 'occasion', members: [aarav, diya, priya, kabir], owner: diya },
    ];
    const groupIds = groups.map((g) => {
      const r = run(
        `INSERT INTO groups (name, emoji, kind, owner_id, currency) VALUES (:name, :emoji, :kind, :owner, 'INR')`,
        { name: g.name, emoji: g.emoji, kind: g.kind, owner: g.owner },
      );
      const gid = Number(r.lastInsertRowid);
      for (const m of g.members) {
        run(`INSERT INTO group_members (group_id, user_id, role) VALUES (:g, :u, :r)`, {
          g: gid, u: m, r: m === g.owner ? 'owner' : 'member',
        });
      }
      return gid;
    });
    const [goaId, flatId, diwaliId] = groupIds;

    // ---- Occasions ----
    const occasions = [
      { title: 'Diwali 2026', type: 'festival', date: '2026-11-08', budget: 45000, color: '#f59e0b', status: 'active', notes: 'Gifts, sweets, decorations and family dinner.' },
      { title: 'Goa Trip 2026', type: 'trip', date: '2026-12-20', budget: 60000, color: '#0ea5e9', status: 'planning', notes: '4 nights, flights + stay + food.' },
      { title: 'Sister\'s Wedding', type: 'event', date: '2027-02-14', budget: 120000, color: '#ec4899', status: 'planning', notes: 'Contribution + travel.' },
      { title: 'New Year Party', type: 'festival', date: '2026-12-31', budget: 15000, color: '#8b5cf6', status: 'planning', notes: 'Rooftop party with friends.' },
    ];
    const occasionIds = occasions.map((o) => {
      const r = run(
        `INSERT INTO occasions (user_id, title, type, date, budget, color, notes, status)
         VALUES (:u, :title, :type, :date, :budget, :color, :notes, :status)`,
        { u: aarav, ...o },
      );
      return Number(r.lastInsertRowid);
    });

    // ---- Personal expenses ----
    for (const [cat, merchant, vpa, note, amount, direction, method, when] of EXPENSE_TEMPLATES) {
      const c = categoryByName(cat);
      run(
        `INSERT INTO expenses (user_id, account_id, amount, direction, merchant, vpa, category_id, note, method, occurred_at, source, txn_ref)
         VALUES (:u, :a, :amount, :direction, :merchant, :vpa, :cat, :note, :method, :when, 'seed', :ref)`,
        {
          u: aarav, a: account, amount, direction, merchant, vpa, cat: c.id, note,
          method, when, ref: `SEED${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
        },
      );
    }

    // ---- Income / credits (salary and reimbursements) ----
    const INCOME = [
      ['Employer Payroll', 'employer.payroll@hdfcbank', 'Monthly salary', 85000, '2026-09-01 09:00:00'],
      ['Employer Payroll', 'employer.payroll@hdfcbank', 'Monthly salary', 85000, '2026-10-01 09:00:00'],
      ['Employer Payroll', 'employer.payroll@hdfcbank', 'Monthly salary', 85000, '2026-11-01 09:00:00'],
      ['Freelance Client', 'studio.ink@ybl', 'Design retainer', 12000, '2026-09-18 14:00:00'],
      ['Freelance Client', 'studio.ink@ybl', 'Design retainer', 12000, '2026-10-18 14:00:00'],
      ['Splitwise Settle', 'diya.sharma@ybl', 'Settlement received', 5000, '2026-09-25 10:05:00'],
      ['Flatmate Transfer', 'kabir.singh@ibl', 'Rent share received', 12000, '2026-10-05 10:05:00'],
      ['Interest Credit', null, 'Savings interest', 640, '2026-09-30 23:59:00'],
      ['Interest Credit', null, 'Savings interest', 712, '2026-10-31 23:59:00'],
      ['Refund', 'amazon@apl', 'Order refund', 1299, '2026-11-06 11:00:00'],
    ];
    for (const [merchant, vpa, note, amount, when] of INCOME) {
      run(
        `INSERT INTO expenses (user_id, account_id, amount, direction, merchant, vpa, category_id, note, method, occurred_at, source, txn_ref)
         VALUES (:u, :a, :amount, 'credit', :merchant, :vpa, :cat, :note, :method, :when, 'seed', :ref)`,
        {
          u: aarav, a: account, amount, merchant, vpa, cat: categoryByName('Transfers').id, note,
          method: vpa ? 'upi' : 'bank', when,
          ref: `SEED${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
        },
      );
    }

    // ---- Group expenses (split) ----
    const groupExpenses = [
      { g: goaId, payer: aarav, amount: 18500, merchant: 'MakeMyTrip', note: 'Flights (4 pax)', cat: 'Travel', mode: 'equal', when: '2026-09-20 11:00:00', participants: [aarav, diya, rohan, priya] },
      { g: goaId, payer: diya, amount: 24000, merchant: 'Airbnb Goa', note: 'Beach villa 4 nights', cat: 'Travel', mode: 'equal', when: '2026-09-21 16:00:00', participants: [aarav, diya, rohan, priya] },
      { g: goaId, payer: rohan, amount: 6200, merchant: 'Fisherman\'s Wharf', note: 'Group dinner', cat: 'Dining', mode: 'equal', when: '2026-09-22 21:30:00', participants: [aarav, diya, rohan, priya] },
      { g: goaId, payer: priya, amount: 3400, merchant: 'Scooter Rental', note: '2 scooters x 2 days', cat: 'Transport', mode: 'shares', when: '2026-09-23 09:00:00', participants: [{ u: aarav, v: 2 }, { u: diya, v: 1 }, { u: rohan, v: 1 }, { u: priya, v: 2 }] },
      { g: flatId, payer: aarav, amount: 48000, merchant: 'Landlord', note: 'November rent', cat: 'Rent', mode: 'equal', when: '2026-11-01 10:00:00', participants: [aarav, rohan, kabir] },
      { g: flatId, payer: rohan, amount: 3200, merchant: 'Tata Power', note: 'Electricity', cat: 'Bills', mode: 'exact', when: '2026-11-05 12:00:00', participants: [{ u: aarav, v: 1400 }, { u: rohan, v: 900 }, { u: kabir, v: 900 }] },
      { g: flatId, payer: kabir, amount: 2100, merchant: 'Blinkit', note: 'Shared groceries', cat: 'Groceries', mode: 'equal', when: '2026-11-09 19:00:00', participants: [aarav, rohan, kabir] },
      { g: diwaliId, payer: diya, amount: 9600, merchant: 'Flipkart', note: 'Decoration + lights', cat: 'Shopping', mode: 'percent', when: '2026-10-28 20:00:00', participants: [{ u: aarav, v: 30 }, { u: diya, v: 30 }, { u: priya, v: 20 }, { u: kabir, v: 20 }] },
      { g: diwaliId, payer: priya, amount: 7200, merchant: 'Sweet Shop', note: 'Diwali sweets for everyone', cat: 'Dining', mode: 'equal', when: '2026-11-07 17:00:00', participants: [aarav, diya, priya, kabir] },
    ];

    for (const ge of groupExpenses) {
      const c = categoryByName(ge.cat);
      const r = run(
        `INSERT INTO expenses (user_id, group_id, occasion_id, amount, direction, merchant, category_id, note, method, occurred_at, source)
         VALUES (:u, :g, :o, :amount, 'debit', :merchant, :cat, :note, 'upi', :when, 'group')`,
        {
          u: ge.payer, g: ge.g, o: ge.g === diwaliId ? occasionIds[0] : null,
          amount: ge.amount, merchant: ge.merchant, cat: c.id, note: ge.note, when: ge.when,
        },
      );
      const expenseId = Number(r.lastInsertRowid);
      const participants = ge.participants.map((p) => (typeof p === 'number' ? { user_id: p } : { user_id: p.u, value: p.v }));
      const shares = computeShares(ge.amount, participants, ge.mode);
      for (const s of shares) {
        run(
          `INSERT INTO group_expense_shares (expense_id, user_id, share, weight) VALUES (:e, :u, :s, :w)`,
          { e: expenseId, u: s.user_id, s: s.share, w: s.weight },
        );
      }
    }

    // ---- Settlements ----
    run(
      `INSERT INTO settlements (group_id, from_user, to_user, amount, note, settled_at) VALUES (:g, :f, :t, :a, :n, :w)`,
      { g: goaId, f: priya, t: diya, a: 5000, n: 'Part payment for villa', w: '2026-09-25 10:00:00' },
    );
    run(
      `INSERT INTO settlements (group_id, from_user, to_user, amount, note, settled_at) VALUES (:g, :f, :t, :a, :n, :w)`,
      { g: flatId, f: kabir, t: aarav, a: 12000, n: 'Rent share — Oct', w: '2026-10-05 10:00:00' },
    );

    // ---- Budgets ----
    const budgetPlan = [
      ['Groceries', 12000], ['Dining', 6000], ['Transport', 3000], ['Fuel', 5000],
      ['Shopping', 8000], ['Bills', 6000], ['Rent', 25000], ['Health', 3000],
      ['Entertainment', 2000], ['Travel', 10000], ['Software', 3000], ['Investments', 15000],
    ];
    for (const [cat, amount] of budgetPlan) {
      const c = categoryByName(cat);
      run(
        `INSERT INTO budgets (user_id, category_id, period, amount) VALUES (:u, :c, 'monthly', :a)`,
        { u: aarav, c: c.id, a: amount },
      );
    }

    // ---- Recurring ----
    const recurringPlan = [
      ['Netflix', 'netflix@axl', 649, 'Entertainment', 'monthly', '2026-12-10'],
      ['Airtel Postpaid', 'airtel@axisbank', 999, 'Bills', 'monthly', '2026-12-04'],
      ['House Rent', 'landlord@okhdfcbank', 24000, 'Rent', 'monthly', '2026-12-01'],
      ['OpenAI ChatGPT', 'openai@apl', 1999, 'Software', 'monthly', '2026-12-15'],
      ['Groww SIP', 'groww@ybl', 10000, 'Investments', 'monthly', '2026-12-17'],
    ];
    for (const [merchant, vpa, amount, cat, freq, next] of recurringPlan) {
      const c = categoryByName(cat);
      run(
        `INSERT INTO recurring (user_id, merchant, vpa, amount, category_id, frequency, next_due)
         VALUES (:u, :m, :v, :a, :c, :f, :n)`,
        { u: aarav, m: merchant, v: vpa, a: amount, c: c.id, f: freq, n: next },
      );
    }

    return { seeded: true, users: userIds, groups: groupIds, occasions: occasionIds };
  });
}
