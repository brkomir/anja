# Engagement Patterns

Case studies, implementation patterns, and advanced behavioral design techniques. The agent reads this when designing specific engagement features.

## Case Studies: How Great Products Sustain Engagement

### Duolingo — The Gold Standard of Gamification
**Source:** the churn, streak-commitment and user-count figures are restated from public growth write-ups and Duolingo's own blog post on streaks; no text is copied.

**What they do:**
- **Streaks:** Daily practice counter with streak-freeze items (miss one day without losing progress)
- **Leaderboards:** Weekly XP competition against similarly-active users (algorithmic segmentation)
- **Hearts:** Limited mistakes per lesson — failure has stakes
- **XP system:** Variable XP amounts create unpredictable rewards
- **Leagues:** Bronze → Silver → Gold → Diamond progression tiers

**Why it works:**
- Streaks exploit loss aversion (protecting a 30-day streak feels more urgent than starting one)
- Leaderboards use social comparison against achievable peers (not the top 0.1%)
- Variable XP satisfies the "Hunt" reward type (what will I earn this time?)
- Streak freeze is a safety valve that prevents catastrophic loss (key to preventing churn from a single missed day)

**Results:** Churn dropped from 47% to 28%. Streak commitment up 60%. 100M+ monthly active users.

**Lesson for other products:** Streaks work when the cadence matches natural usage. Duolingo = daily (language needs daily practice). Photography ≠ daily. Weekly or per-shoot cadence is more honest.

### Strava — Social Identity + Data Accumulation

**What they do:**
- Training log as permanent record (switching cost)
- Segments: compete on specific routes against all users who've done them
- Kudos: lightweight social validation (one-tap, no pressure)
- Year-in-review: aggregate stats that feel personal and shareable
- Local leaderboards: competition at a human scale

**Why it works:**
- Exercise data accumulates into an irreplaceable record (investment)
- Segments turn every run/ride into a potential PR (variable reward)
- Kudos satisfy relatedness without requiring high effort
- Year-in-review creates shareable moments (growth loop)

**Lesson:** Accumulated data is the strongest retention tool. The more history a user builds, the harder it is to leave. Make the user's history visible and valuable.

### Notion — Content-Driven Viral Loop
**Source:** the invite-rate and K-factor figures are restated from a public SaaS viral-loop write-up; no text is copied.

**What they do:**
- Users create templates → share publicly → new users duplicate (requiring signup)
- Progressive complexity: start simple, discover depth over time
- Personal workspace feels like "yours" (ownership)

**Why it works:**
- The product gets more valuable with use (investment)
- Sharing is organic — templates solve real problems for others
- 60% of template duplicators invite teammates (K-factor 0.62)

**Lesson:** If users create something valuable in your product, make it easy to share. The sharing IS the growth loop.

### Figma — Natural Collaboration Trigger

**What they do:**
- Designers share prototypes for feedback → viewers sign up to comment
- Real-time collaboration makes switching to solo tools feel lonely
- Community files and resources create ecosystem lock-in

**Why it works:**
- The trigger to share is organic (designers naturally want feedback)
- Viewers become users through genuine value, not tricks
- Collaboration creates social investment that's hard to replicate

**Lesson:** Identify the moments when users naturally want to involve others. Build sharing into those moments, not as a separate feature.

## Engagement Patterns for Skill-Building Products

This is a skill-building product — users should get measurably better over time. These patterns are specific to that category.

### Pattern 1: The Progress Dashboard

**What:** A dedicated view showing improvement over time.

**Elements:**
- Score trajectory chart (average score per month)
- Tier distribution (how many A, B, C critiques)
- Bottleneck frequency map (what issues come up most → shows what to practice)
- "Personal best" highlight (highest-scoring photo)
- Comparison: first critique vs most recent (progress is visceral)

**Psychology:** Competence (SDT). Development & Accomplishment (Octalysis CD2). The user can SEE they're improving, which is the strongest retention force in skill-building products.

**Implementation principle:** Only show real progress. If scores aren't improving, don't hide it — but frame it constructively ("Your consistency is strong — here's where to focus next").

### Pattern 2: The Mastery Path

**What:** A clear progression from beginner to advanced.

**Elements:**
- Tier progression: C → C+ → B- → B → B+ → A- → A
- Milestones tied to real achievement: "First B+ critique", "First A-tier photo"
- Genre mastery: track improvement per genre (landscape, portrait, etc.)
- Optional: "Photography age" — how long since first critique

**Psychology:** Competence + Autonomy (SDT). The user chooses what to master and sees clear steps forward.

**Anti-pattern:** Don't create artificial gates ("Complete 10 critiques to unlock advanced features"). Let the mastery be the photography skill itself, not platform tasks.

### Pattern 3: The Curiosity Loop

**What:** Each critique creates a question that pulls the user back.

**How it works:**
1. Critique identifies ONE bottleneck → "What happens if I fix this?"
2. User edits their photo → "Did my score go up?"
3. V2 critique reveals new bottleneck → "There's more to improve?"
4. Potential score shows ceiling → "Can I actually reach that?"

**Psychology:** Unpredictability & Curiosity (Octalysis CD7). Variable Reward of the Self (Hook Model). The open question "what will the next critique say?" is the pull.

**Key:** The curiosity must be about THEIR photography, not about the product. "What score will I get?" is healthier than "What badge will I unlock?"

### Pattern 4: The Identity Investment

**What:** Users build a public identity in the product that becomes part of how they see themselves.

**Elements:**
- Photographer profile with portfolio
- Gallery of published work with scores
- "Photographer since [date]" status
- Genre specialization badges (earned through consistent high scores, not participation)

**Psychology:** Ownership & Possession (Octalysis CD4). Unity (Cialdini). Relatedness (SDT).

**Why it retains:** When "I'm a B+ landscape photographer working toward A-tier" becomes part of their identity, leaving the platform means leaving that identity behind.

### Pattern 5: The Social Proof Engine

**What:** Aggregate behavior that validates individual engagement.

**Elements:**
- "1,200 photographers improved their scores this month"
- "Most common bottleneck: tonal hierarchy (you're not alone)"
- "Photos with V3+ score 40% higher on average than V1" (proves iteration works)
- Community gallery showing real improvement stories

**Psychology:** Social Proof + Authority (Cialdini). Relatedness (SDT). Social Influence (Octalysis CD5).

**Rule:** Every number must be real. Fabricating social proof is the fastest path to distrust.

## Re-Engagement Strategies

When users go inactive, here's the psychology of bringing them back:

### Timing

| Inactive Period | Interpretation | Approach |
|----------------|---------------|----------|
| 3-7 days | Normal gap (photographers don't shoot daily) | No action needed |
| 7-14 days | Mild disengagement | Gentle, value-first nudge |
| 14-30 days | Significant lapse | Curiosity trigger or social proof |
| 30+ days | At risk of churning | Direct, honest re-engagement |

### Re-Engagement Triggers (Ethical)

| Trigger | Example | Psychology |
|---------|---------|-----------|
| **Curiosity** | "We updated our critique engine — your photos might score differently now" | Unpredictability |
| **Social proof** | "847 photographers got critiques this week" | Social influence |
| **Progress reminder** | "You were at B+ — one session could push you to A-" | Zeigarnik effect |
| **Seasonal** | "Competition season is starting — is your portfolio ready?" | Relevance |
| **Product update** | "New: compare any two photos side by side" | Genuine value |

### Never Do These

- "We miss you!" (clingy, no value)
- "Your streak is about to expire!" (if they don't have a streak, this is guilt-tripping)
- "Limited time offer — 50% off!" (desperation signal)
- Daily re-engagement emails (harassment)
- Push notifications they didn't opt into (trust violation)

## The Engagement Audit Checklist

When evaluating any feature for engagement impact, score it:

| Criterion | Score (1-5) |
|-----------|-------------|
| Does it serve a real user need? | |
| Does it create a variable reward? | |
| Does it build investment (data, identity, social capital)? | |
| Does it support Autonomy? | |
| Does it support Competence? | |
| Does it support Relatedness? | |
| Is the incentive aligned (user benefit = business benefit)? | |
| Would the user thank you if they understood the design? | |
| **Total** | **/40** |

- **32-40:** Strong engagement design. Ship it.
- **24-31:** Good foundation, refine before shipping.
- **16-23:** Significant gaps. Redesign before building.
- **Below 16:** This is either not serving users or is manipulative. Rethink entirely.

## Engagement Cadence by Product Type

Not every product should aim for daily engagement:

| Product Type | Natural Cadence | Forcing Daily = |
|-------------|----------------|-----------------|
| Language learning (Duolingo) | Daily | Appropriate |
| Fitness tracking (Strava) | 3-5× per week | Appropriate |
| Photo editing tool | Per shoot (2-5× per week) | Appropriate |
| **Photo critique (the source project)** | **Per shoot or per edit session (1-3× per week)** | **Honest** |
| Tax software | Seasonal | Would be absurd |

**Match your engagement mechanics to the user's natural rhythm.** Forcing a daily cadence on a weekly-use product breeds resentment and churn, not habits.

## Strategic Mental Models

Beyond the core frameworks (Hook, Fogg, SDT, Cialdini, Octalysis), these mental models sharpen product thinking and help diagnose engagement problems at a deeper level.

### Jobs to Be Done (JTBD)

Users don't buy products — they hire them for a job.

| Component | Question | Source-project Example |
|-----------|---------|-------------------|
| **When** | In what situation? | "When I finish editing a photo..." |
| **I want to** | What progress? | "...get objective feedback on quality..." |
| **So I can** | What outcome? | "...decide if it's portfolio-ready or needs more work." |

**Product implication:** Features that help the user complete the job get retained. Features that are tangential to the job get ignored regardless of how clever they are.

### The Theory of Constraints

Every system has one bottleneck limiting throughput. Improving anything that isn't the bottleneck is waste.

**Applied to engagement:**
1. Map the user journey: signup → first upload → first critique → iteration → habit → upgrade
2. Measure conversion at each step
3. The step with the lowest conversion IS the bottleneck
4. Fix only that step. Then re-measure. The bottleneck will move.

**Common mistake:** Optimizing the pricing page when the real bottleneck is that 60% of users don't complete their first upload. Fix activation first.

### Inversion (Charlie Munger)

Instead of asking "How do we increase engagement?", ask "How would we guarantee users NEVER come back?"

| "How to kill engagement" | Inversion = What to protect |
|-------------------------|---------------------------|
| Give generic, unhelpful feedback | Maintain critique specificity and quality |
| Make it slow (>30s for results) | Keep time-to-value under 30 seconds |
| Score everything 7+ regardless | Preserve honest, calibrated scoring |
| Require 5 clicks to upload | Keep upload to 1-2 actions |
| Send daily notification spam | Respect natural usage cadence |
| Hide progress and history | Make improvement data visible and central |

### The Barbell Strategy

Combine high-frequency low-effort actions with occasional high-effort high-reward actions. Avoid the mediocre middle.

| Low effort, frequent | High effort, occasional |
|---------------------|------------------------|
| Quick upload + critique (30 sec) | Portfolio curation session (30 min) |
| Check score on recent photo | Deep iteration: V1 → V2 → V3 comparison |
| Glance at progress dashboard | Competition preparation workflow |

**Avoid the middle:** Features that require moderate effort for moderate reward feel like chores. They're the first things users stop doing.

### Second-Order Thinking

Every feature has first-order effects (intended) and second-order effects (unintended). Map both before building.

| Feature | First-Order Effect | Second-Order Effect | Risk |
|---------|-------------------|--------------------|----|
| Streaks | Increases return frequency | Users upload garbage photos to maintain streak | Dilutes portfolio quality |
| Leaderboards | Motivates improvement | Low-ranked users feel demoralized and churn | Net negative for bottom 50% |
| A free tier | Drives signups | Users create multiple accounts to bypass limits | Inflates free-tier costs |
| Share critique links | Word-of-mouth growth | Scores become public — users only share high scores | Survivor bias in marketing |

### Paradox of Choice (Barry Schwartz)

More options reduce satisfaction and action. Every additional choice increases cognitive load.

**Applied to product design:**
- One clear bottleneck per critique (not five issues to fix)
- One recommended tier on pricing page (not "you choose")
- One primary CTA per screen
- One suggested next action after every interaction

### The Peak-End Rule (Kahneman)

People judge an experience by its peak moment and its ending, not the average.

**Product implication:**
- **The peak** should be the critique reveal moment (make it feel like opening a gift)
- **The end** of each session should leave an open loop ("fix this one thing → see what happens")
- A mediocre middle is fine if the peak and end are memorable

### Diminishing Sensitivity

The difference between 2.0 and 4.0 feels massive. The difference between 7.0 and 9.0 feels smaller, even though it's the same gap.

**Scoring implication:** Progress from C to B feels dramatic and motivating. Progress from B+ to A feels slow and frustrating, even though it represents greater skill. Compensate by celebrating small gains at the high end: "B+ → A- is the hardest jump — here's exactly what separates them."

### Summary: When to Apply Each Model

| When You're Stuck On... | Use This Model |
|------------------------|---------------|
| "What feature should we build?" | JTBD — does it serve a real job? |
| "Why aren't users converting?" | Theory of Constraints — find the bottleneck |
| "How could this feature backfire?" | Inversion + Second-Order Thinking |
| "Users aren't coming back" | Barbell Strategy — check your effort/reward ratio |
| "Users seem overwhelmed" | Paradox of Choice — reduce options |
| "The experience feels flat" | Peak-End Rule — design the peak and the ending |
| "High-level users are plateauing" | Diminishing Sensitivity — celebrate small gains |
