# Pricing Playbook

Step-by-step frameworks for designing, evaluating, and iterating on SaaS pricing tiers.

## Step 1: Know Your Costs

Before pricing, calculate the cost floor for each user action.

### Cost-Per-Action Worksheet

```
1. API cost per request:
   Input tokens:  _____ × $_____ / 1M = $_____
   Output tokens: _____ × $_____ / 1M = $_____
   Subtotal API cost: $_____

2. Infrastructure per request:
   Image processing: $_____
   Storage (amortized): $_____
   Database ops: $_____
   Subtotal infra: $_____

3. Total cost per action: $_____ (API + infra)

4. Monthly cost per user at different utilization:
   Light (20% of limit):  _____ actions × $_____ = $_____/month
   Medium (50% of limit): _____ actions × $_____ = $_____/month
   Heavy (100% of limit): _____ actions × $_____ = $_____/month
```

### Stripe Fees

Always include in margin calculations:
- A percentage of each charge plus a fixed fee per successful charge
- For a monthly subscription at the product's price point: the fee comes off every charge → net is the price minus the fee
- For an annual subscription: the fee comes off one larger charge per year → divide the net by 12 for the effective monthly figure

## Step 2: Choose Your Value Metric

### Decision Framework

Ask these questions:

1. **What does the customer actually pay for?** Not features -- outcomes.
2. **What grows as the customer gets more value?** That's your metric.
3. **Can you explain it in 5 words?** If not, it's too complex.

### Metric Evaluation Matrix

Score each candidate metric 1-5:

| Criteria | Score |
|----------|-------|
| Correlates with perceived value | |
| Easy for customer to understand | |
| Predictable (customer can budget) | |
| Grows with customer success | |
| Hard to game | |
| Simple to implement | |
| **Total** | **/30** |

Any metric scoring below 20 should be reconsidered.

### Common Patterns for AI Products

| Pattern | Example | Pros | Cons |
|---------|---------|------|------|
| **Actions per period** | N actions/month | Simple, predictable | Users ration; heavy users expensive |
| **Flat + overage** | 50 included, $0.10 each extra | Predictable base, scales naturally | Overage surprise can frustrate |
| **Tiered flat rate** | Free / mid / top price with increasing limits | Simplest to understand | Heavy user on mid-tier may cost more than they pay |
| **Credit system** | Buy 100 credits for $10 | Flexible, user controls spend | Requires credit management UX |
| **Outcome-based** | Per successful result | Perfectly aligned with value | Hard to define "success," variable revenue |

## Step 3: Design Your Tiers

### The Three-Tier Template

```
┌─────────────┬──────────────────┬──────────────────┬──────────────────┐
│             │ Free / Starter   │ Pro / Growth      │ Team / Business  │
├─────────────┼──────────────────┼──────────────────┼──────────────────┤
│ Role        │ Acquisition      │ Revenue engine    │ Expansion        │
│ Target      │ Try before buy   │ Individual power  │ Teams / orgs     │
│ Price       │ $0               │ $X/month          │ $2-3× Pro        │
│ Margin      │ Negative (ok)    │ Highest           │ High             │
│ Badge       │ —                │ "Most Popular"    │ —                │
├─────────────┼──────────────────┼──────────────────┼──────────────────┤
│ Core value  │ ✓ (limited)      │ ✓ (generous)      │ ✓ (unlimited)    │
│ History     │ Limited          │ Full              │ Full + analytics │
│ Support     │ Community        │ Priority          │ Dedicated        │
│ Unique      │ —                │ Feature X         │ Feature X + Y    │
└─────────────┴──────────────────┴──────────────────┴──────────────────┘
```

### Tier Transition Triggers

Design limits so that users naturally hit them as they get more engaged:

| User Stage | Behavior | Trigger |
|-----------|----------|---------|
| Casual | Tries 2-3 times, decides if useful | Never hits free limit |
| Regular | Uses 3-5× per week consistently | Starts hitting weekly limit |
| Power | Uses daily, depends on it | Clearly needs Pro volume |
| Team | Shares with colleagues, wants collaboration | Needs Team features |

**The golden rule:** Free limits should let a casual user be happy forever, but a regular user should feel the friction within 2-3 weeks of consistent use.

### Pricing the Gap Between Tiers

| Ratio | Effect |
|-------|--------|
| **Pro = 3-5× Starter value** | Good. Clear step up without sticker shock. |
| **Pro = 10× Starter value** | Great for "Starter is a demo" positioning. |
| **Team = 2-3× Pro price** | Standard. Teams expect per-seat or volume premium. |
| **Team = 5×+ Pro price** | Risky unless Team has dramatically different value. |

## Step 4: Stress-Test Your Pricing

### The Five Scenarios

Run each tier through these:

1. **The freeloader:** Uses max free tier forever, never converts. What does this cost you monthly? Can you sustain 1,000 of them?

2. **The ideal customer:** Converts to Pro in month 2, uses 40-60% of limit, stays 18+ months. What's their LTV? Is it > 3× CAC?

3. **The power user:** Hits Pro limit every month. Are you still gross-margin positive?

4. **The annual churner:** Pays for 3 months then cancels. Did you recover CAC?

5. **The annual customer:** Pays yearly upfront. What's the discount? What's the cash flow impact?

### Margin Sensitivity Table

Build this for your product:

```
| Plan | Price | Stripe Net | Light Use Cost | Medium Cost | Heavy Cost |
|------|-------|-----------|----------------|-------------|------------|
| Free | $0    | $0        | $___           | $___        | $___       |
| Pro  | $X    | $___      | $___           | $___        | $___       |
| Team | $Y    | $___      | $___           | $___        | $___       |

| Plan | Light Margin | Medium Margin | Heavy Margin |
|------|-------------|---------------|--------------|
| Free | -$___       | -$___         | -$___        |
| Pro  | +$___  (__%)| +$___   (___%)| +$___  (__%) |
| Team | +$___  (__%)| +$___   (___%)| +$___  (__%) |
```

**Red flag:** If heavy-use margin is negative or below 30%, you need to either raise the price, lower the limit, or find a cheaper model.

## Step 5: Model Revenue Scenarios

### 12-Month Projection Template

```
Month 1:
  New signups: ___
  Free → Pro conversion: ___% = ___ Pro users
  Pro churn: ___% = ___ lost
  Active Pro users: ___
  MRR: ___ × $X = $___

Repeat for months 2-12, adjusting:
  - Signup growth rate (organic + paid)
  - Conversion rate (should improve with onboarding iteration)
  - Churn rate (should decrease as product improves)
  - Expansion revenue (annual plans, tier upgrades)
```

### Three Scenarios

| | Conservative | Moderate | Optimistic |
|---|-------------|----------|-----------|
| Monthly signup growth | 10% | 20% | 40% |
| Free → Pro conversion | 3% | 5% | 8% |
| Monthly Pro churn | 8% | 5% | 3% |
| Avg utilization | 60% | 40% | 30% |

## Step 6: Iterate

### When to Change Pricing

| Signal | Action |
|--------|--------|
| Free-to-paid conversion < 2% | Free tier too generous OR Pro value not clear |
| Conversion > 15% | Free tier may be too restrictive (losing potential users) |
| Most users at plan limit | Consider raising limits or adding a higher tier |
| Few users near limit | Limits may be too generous (or product not sticky enough) |
| Churn spikes after billing | Price too high for perceived value |
| Users ask for "something between" tiers | Gap too large, consider a middle option |
| Heavy users cost more than they pay | Raise price, lower limit, or use cheaper model |

### Price Increase Playbook

1. **Grandfather existing customers** for 6-12 months (builds trust)
2. Give 60+ days notice before the change takes effect
3. Explain what's improved since they signed up (justify the increase)
4. Offer annual lock-in at the old price (converts monthly → annual)
5. Never increase by more than 30% at once

### Annual Pricing Strategy

| Discount | Effect |
|----------|--------|
| 0% (same price) | Few switch. Only worthwhile if product is very sticky. |
| 10-15% | Moderate adoption. Good for stable products. |
| **16-20%** | Sweet spot. "2 months free" framing works well. |
| 25%+ | Strong adoption but may signal desperation or undervalue the product. |

**Frame as savings, not discounts:**
- "$X/mo or $10X/year (save $2X)" ✓
- "$X/mo or $Y/mo billed annually" (Y = the annual price ÷ 12) ✓
- "Get 2 months free with annual billing" ✓ (most effective framing)

## Step 7: Validate Pricing with Users

Before committing to prices based on internal analysis, validate with real users using these research methods.

**Source:** the Van Westendorp and MaxDiff subsections below are adapted from the public repository coreyhaines31/marketingskills (MIT License, Copyright (c) 2025 Corey Haines), its pricing-strategy skill's research-methods reference; one line is that file's line verbatim and others follow it closely. The licence notice is in .claude/NOTICE; the per-file record is in .claude/third-party-origins.md.

### Van Westendorp Price Sensitivity Meter

The gold standard for early-stage pricing research. Ask four questions to find the acceptable price range.

**The Four Questions:**

1. **Too cheap:** "At what price would you consider this product so inexpensive that you'd question its quality?"
2. **Cheap (bargain):** "At what price would you consider this product a bargain — a great buy for the money?"
3. **Expensive (but acceptable):** "At what price would you start to feel this is getting expensive, but you'd still consider buying it?"
4. **Too expensive:** "At what price would you consider this product so expensive that you wouldn't consider buying it?"

**How to analyze:**

Plot cumulative distribution curves for each question. The intersections reveal:

| Intersection | Name | Meaning |
|-------------|------|---------|
| Too Cheap ∩ Expensive | **Point of Marginal Cheapness (PMC)** | Below this = perceived low quality |
| Cheap ∩ Too Expensive | **Point of Marginal Expensiveness (PME)** | Above this = most people won't buy |
| Cheap ∩ Expensive | **Indifference Price Point (IDP)** | Sweet spot — equal pull up and down |
| Too Cheap ∩ Too Expensive | **Optimal Price Point (OPP)** | Minimum price resistance |

**Acceptable price range** = PMC to PME. Price within this band.

**Implementation tips:**
- Run with 30-100 respondents from your target audience (not general population)
- Use a survey tool (Typeform, Google Forms) — keep it under 5 minutes
- Pair with a product description and screenshot so respondents know what they're pricing
- Segment results by persona (different customer segments give very different answers)
- Run again after major feature additions — willingness to pay shifts with perceived value

### MaxDiff Analysis (Best-Worst Scaling)

Determines which features users value MOST, eliminating the "everything is important" problem.

**How it works:**

1. List 8-12 features or benefits your product offers
2. Show respondents sets of 4-5 features at a time
3. For each set, they pick the MOST important and LEAST important
4. Repeat 8-12 sets per respondent
5. Statistical analysis produces a utility score ranking all features

**Why it's better than "rate 1-5":**
- Forced choice eliminates "everything is a 5" bias
- Produces a clear hierarchy, not a flat distribution
- Reveals the real gap between "important" and "nice to have"

**How to use for pricing:**
- Features with highest utility scores belong in the target tier (Pro)
- Features with low utility can be free tier giveaways (low perceived value = low acquisition cost)
- Features with medium utility are upgrade triggers (noticeable when missing)

**Implementation:**
- Tools: Sawtooth/Lighthouse Studio (enterprise), or Conjointly, SurveyAnalytics (self-serve)
- 50-200 respondents for reliable results
- Pair with Van Westendorp: MaxDiff tells you WHAT to put in each tier, Van Westendorp tells you WHAT TO CHARGE

### When to Use Each Method

| Method | Best For | Sample Size | Cost |
|--------|---------|------------|------|
| **Van Westendorp** | Finding the right price point | 30-100 | Free (DIY survey) |
| **MaxDiff** | Feature prioritization for tier design | 50-200 | $200-2K (tool dependent) |
| **Conjoint Analysis** | Full price × feature optimization | 200+ | $2K-10K |
| **A/B Testing** | Validating pricing in production | 1,000+ visitors | Free (existing traffic) |

**For early-stage SaaS:** Start with Van Westendorp + MaxDiff. They're cheap, fast, and give you 80% of the insight. Save conjoint and A/B testing for when you have traffic and revenue to optimize.

## Anti-Patterns

- **Racing to the bottom on price.** Compete on value, not on being cheapest. Cheap signals low quality in SaaS.
- **Hiding pricing.** Transparent pricing increases trial signups 2-3×. "Contact sales" only makes sense above $10K ACV.
- **Underpricing to "get users first."** You'll attract price-sensitive users who churn when you eventually raise prices.
- **Giving away the core value for free.** The free tier should prove value, not fully deliver it. There must be a reason to upgrade.
- **Ignoring Stripe fees in margin math.** The fixed per-charge part of the fee is a larger share of a low price than of a high one, so low prices get hit hardest.
- **Setting limits based on what's "fair" instead of what's profitable.** Your limits need to work economically, not just feel generous.
- **Copying competitor pricing without understanding their cost structure.** Their margins, funding, and strategy are different from yours.
