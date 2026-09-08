# Job Autofill Extension Architecture

**User:** Anonymous  
**Created:** 9/8/2026 18:01:39  
**Updated:** 9/8/2026 18:08:11  
**Exported:** 9/8/2026 18:08:56  
**Link:** [https://chatgpt.com/g/g-p-6a7cbf9813388191808a96673869dc7b-ideas/c/6aa0002a-2d98-83e8-8dc3-5b3cfa73c2eb](https://chatgpt.com/g/g-p-6a7cbf9813388191808a96673869dc7b-ideas/c/6aa0002a-2d98-83e8-8dc3-5b3cfa73c2eb)  

## Prompt:
08/09/2026, 18:05:28

i am struggling in job apply everytime i open then i need to fill sasme detsils again and again and reusume , but there are few tools like simplyfi and all 

there are few extemsion as well i want to make i tool but the isue is it does not work on all websites so i want to make this extesion in such a way that we can  open on aal page and detceh my cursor blink in any input field we will feed the information in this we will keep all the info in databse it  will find my all info from that andn resume pdf and can  auto fill or allow me to copy and paste in the field we will use mistral ai free for this it will detech the qustion or else extion will be oepnm in side and we will page the qurstion and based on my profile and my tone wil give me the ans then i will paste it 

how to make this make this plan and architecture and agenticn and make sure it will not ooff in any page and i can open this exsctiona nd copy page if aut fill  do not work

## Response:
08/09/2026, 18:05:35

> **Searching the web**
>
> [Pricing | Mistral](https://mistral.ai/pricing/)
> [Usage and limits | Mistral Docs](https://docs.mistral.ai/admin/billing-usage/usage-limits)
> [Why am I hitting API rate limits, and how do I increase them? | Mistral Help Center](https://help.mistral.ai/en/articles/698531-why-am-i-hitting-api-rate-limits-and-how-do-i-increase-them)
> [API reference  |  Chrome for Developers](https://developer.chrome.com/docs/extensions/reference/api)
>
> **Searched 4 websites**
>
> 
>
> Worked for 11s

Yes. The idea is **very feasible**, but I would design it differently from a normal “job autofill extension.”

The core product should be:

> **A universal job-application copilot that works on almost any webpage, detects the field/question the user is interacting with, retrieves the right information from their profile/resume, and either fills it automatically or gives the user a one-click answer to copy.**

The important part is **not trying to perfectly understand every website**. Instead, build a **fallback architecture** where even if autofill fails, the extension remains useful.

---

# 1. The product I would build

Think of the extension as having **4 modes**:

### Mode 1 - Auto Detect + Autofill

User opens:

> LinkedIn → Easy Apply  
> Greenhouse  
> Lever  
> Workday  
> Ashby  
> Tario  
> company careers page  
> random startup application page

The extension watches the page.

User clicks:

> "Years of experience with Python?"

Extension detects the field and maps it to:

```text
question
    ↓
"What is your experience with Python?"
    ↓
Profile Knowledge Base
    ↓
Python = 2 years
    ↓
Fill input
```

---

### Mode 2 - Smart Suggestion

If it isn't confident enough to autofill:

```text
Python experience

[ 2 years ]

✓ Insert
📋 Copy
✏️ Edit
```

The user clicks **Insert**.

---

### Mode 3 - AI Answer

For questions like:

> Why do you want to work at Tario?

or:

> Tell us about a project you're proud of.

The extension sends:

```text
Question
+
User profile
+
Resume
+
Projects
+
Experience
+
Skills
+
Preferred tone
+
Company information
```

to the LLM.

It generates:

```text
I’m particularly interested in Tario because...
```

Then:

**Copy**

or

**Insert**

---

### Mode 4 - Universal Side Panel

This is the most important fallback.

If autofill doesn't work:

**Open Extension**

and the side panel shows:

```text
┌───────────────────────────────┐
│ JobPilot                      │
│                               │
│ Current page                  │
│ tario.talismatic.com           │
│                               │
│ Detected questions             │
│                               │
│ ┌───────────────────────────┐ │
│ │ Why do you want to join   │ │
│ │ Tario?                    │ │
│ │                           │ │
│ │ [ Generate Answer ]       │ │
│ └───────────────────────────┘ │
│                               │
│ ┌───────────────────────────┐ │
│ │ Years of Python experience│ │
│ │                           │ │
│ │ 2 years                  │ │
│ │                           │ │
│ │ [Copy] [Insert]           │ │
│ └───────────────────────────┘ │
└───────────────────────────────┘
```

This means **the product doesn't become useless just because a website breaks your autofill logic.**

Chrome's Side Panel API is designed specifically for hosting extension UI alongside webpages, and is available for MV3 extensions. ([Chrome for Developers](https://developer.chrome.com/docs/extensions/reference/api?utm_source=chatgpt.com))

---

# 2. The key architectural decision

Don't build:

```text
Website → scraper → AI → autofill
```

Build:

```text
                    ┌───────────────┐
                    │ User Profile  │
                    │ Knowledge DB  │
                    └───────┬───────┘
                            │
                            ↓
┌───────────────┐     ┌──────────────┐
│ Current Web   │────→│ Field        │
│ Page          │     │ Understanding│
└───────────────┘     └──────┬───────┘
                             │
              ┌──────────────┼──────────────┐
              ↓              ↓              ↓
          Autofill       Suggestion      AI Answer
              │              │              │
              └──────────────┼──────────────┘
                             ↓
                       User confirms
```

This separation is extremely important.

---

# 3. Architecture

I would use this stack.

### Browser Extension

```text
Chrome Extension
Manifest V3

├── Content Script
├── Background Service Worker
├── Side Panel
├── Popup
├── Options/Profile UI
└── Storage
```

Chrome's current extension platform supports MV3, content scripting, runtime messaging, scripting APIs and Side Panel APIs. ([Chrome for Developers](https://developer.chrome.com/docs/extensions/reference/api?utm_source=chatgpt.com))

---

### Web Application

```text
Next.js
   │
   ├── Authentication
   ├── Profile management
   ├── Resume management
   ├── Applications
   └── Settings
```

---

### Backend

Since you're already comfortable with Supabase, I would use:

```text
Supabase
├── PostgreSQL
├── Auth
├── Storage
└── Edge Functions
```

---

### AI

Initially:

```text
Mistral API
```

Mistral currently provides a Free mode with API access and included monthly usage, but it has lower limits intended for evaluation/prototyping, so design the AI layer behind an abstraction rather than hard-coding the entire product around “free Mistral.” ([Mistral AI](https://docs.mistral.ai/admin/billing-usage/usage-limits?utm_source=chatgpt.com))

The current Mistral API supports chat completions, and Mistral also provides TypeScript SDK support. ([Mistral AI](https://docs.mistral.ai/api?utm_source=chatgpt.com))

---

# 4. Complete system architecture

```text
                         USER
                           │
                           ↓
                  ┌─────────────────┐
                  │ Chrome Extension│
                  └────────┬────────┘
                           │
             ┌─────────────┼─────────────┐
             ↓             ↓             ↓
        Content Script  Side Panel     Popup
             │             │
             └──────┬──────┘
                    ↓
             Extension Core
                    │
       ┌────────────┼────────────┐
       ↓            ↓            ↓
 Field Detector  Page Parser  DOM Observer
       │            │            │
       └────────────┼────────────┘
                    ↓
             Field Normalizer
                    │
                    ↓
             Question Classifier
                    │
        ┌───────────┼───────────┐
        ↓           ↓           ↓
    Deterministic  Profile     AI
      Matcher      Matcher    Matcher
        │           │           │
        └───────────┼───────────┘
                    ↓
              Answer Engine
                    │
             ┌──────┴──────┐
             ↓             ↓
          Autofill       Copy
             │             │
             └──────┬──────┘
                    ↓
                 USER
```

---

# 5. The most important component: Field Detection

This is where most autofill extensions fail.

Don't just look for:

```javascript
input[type="text"]
```

You need to understand **what the input means**.

For every field collect:

```json
{
  "tag": "input",
  "type": "text",
  "name": "candidate_python_experience",
  "id": "experience-python",
  "placeholder": "Years of experience",
  "ariaLabel": "Python experience",
  "label": "How many years of experience do you have with Python?",
  "nearbyText": "...",
  "options": [],
  "required": true
}
```

Then normalize it:

```json
{
  "fieldType": "experience",
  "skill": "Python",
  "question": "How many years of experience do you have with Python?"
}
```

---

# 6. Don't depend only on HTML attributes

You need multiple signals.

### Signal 1

```text
<label>
```

### Signal 2

```text
aria-label
```

### Signal 3

```text
placeholder
```

### Signal 4

```text
name
```

### Signal 5

```text
id
```

### Signal 6

Nearby DOM text.

### Signal 7

Parent container.

### Signal 8

Question text immediately above the input.

### Signal 9

Select options.

For example:

```text
How many years have you worked with Python?

○ Less than 1
○ 1-2
○ 3-5
○ 5+
```

Your detector needs to associate the radio buttons with the question.

---

# 7. DOM Observer is critical

Job applications are often SPAs.

For example:

```text
Page loads
↓
React renders
↓
Question appears
↓
User clicks Next
↓
New questions appear
```

Therefore you can't scan the DOM only once.

Use:

```javascript
MutationObserver
```

Conceptually:

```text
Page loaded
     ↓
Scan DOM
     ↓
Observe DOM
     ↓
New input detected?
     ↓
Yes
     ↓
Analyze field
```

This is one of the things that makes the extension work across dynamic job portals.

---

# 8. Your Universal Field Pipeline

Every field should go through:

```text
RAW DOM
   ↓
Field Extraction
   ↓
Field Normalization
   ↓
Question Understanding
   ↓
Intent Classification
   ↓
Profile Retrieval
   ↓
Answer Generation
   ↓
Confidence Score
   ↓
Action
```

---

# 9. Question classification

Create a fixed taxonomy.

For example:

```text
PERSONAL
├── First name
├── Last name
├── Email
├── Phone
├── Location
└── Address

PROFESSIONAL
├── Current company
├── Job title
├── Experience
├── Skills
└── Notice period

EDUCATION
├── Degree
├── University
├── Graduation year
└── GPA

WORK AUTHORIZATION
├── Visa
├── Sponsorship
└── Work authorization

COMPENSATION
├── Expected salary
├── Current salary
└── CTC

EXPERIENCE
├── Python
├── SQL
├── React
├── AWS
└── etc.

OPEN ENDED
├── Why company?
├── Why role?
├── Tell me about yourself
├── Biggest achievement
├── Project
└── Cover letter

BEHAVIORAL
├── Leadership
├── Conflict
├── Failure
├── Teamwork
└── Challenge
```

This allows you to avoid calling an LLM for everything.

---

# 10. Use a deterministic-first architecture

This is extremely important for cost and reliability.

Suppose the page asks:

> Email address

Don't ask Mistral.

Your system already knows:

```text
email → profile.email
```

Likewise:

```text
First name → profile.firstName

Last name → profile.lastName

Phone → profile.phone

LinkedIn → profile.linkedin

GitHub → profile.github

Portfolio → profile.portfolio

Current title → profile.currentTitle
```

This gives you:

**faster + cheaper + more reliable autofill.**

---

# 11. Then use semantic matching

Suppose the website says:

> How many years have you been working professionally with Python?

Your database has:

```text
skills:
Python
experience: 2 years
```

Semantic matching maps:

```text
"working professionally with Python"

→ Python experience

→ 2 years
```

You can use embeddings later.

Initially, Mistral can classify difficult questions.

---

# 12. Your personal knowledge database

This is the heart of the product.

Don't simply save:

```text
resume.pdf
```

Create structured knowledge.

For example:

```text
USER
│
├── Personal
│
├── Contact
│
├── Education
│
├── Experience
│
├── Skills
│
├── Projects
│
├── Certifications
│
├── Achievements
│
├── Preferences
│
├── Work Authorization
│
├── Compensation
│
├── Resume Versions
│
└── Answer Library
```

---

# 13. Database schema

Supabase/Postgres:

### users

```text
id
email
name
created_at
```

### profiles

```text
user_id
first_name
last_name
phone
location
linkedin
github
portfolio
current_title
summary
```

### experiences

```text
id
user_id
company
title
start_date
end_date
description
```

### skills

```text
id
user_id
name
years
level
last_used
```

### education

```text
id
user_id
institution
degree
field
start_year
end_year
gpa
```

### projects

```text
id
user_id
name
description
technologies
url
impact
```

### resumes

```text
id
user_id
name
file_url
version
is_default
parsed_text
```

---

# 14. Resume ingestion

User uploads:

```text
resume.pdf
```

Pipeline:

```text
PDF
 ↓
Text extraction
 ↓
Resume parser
 ↓
Structured profile
 ↓
User reviews
 ↓
Database
```

Don't blindly trust AI extraction.

Show:

```text
We found:

Python → 2 years
SQL → 2 years
React → 1 year
Next.js → 1 year

[Confirm]
```

Then save it.

---

# 15. Answer Library

This can become one of your strongest features.

For example:

```text
Question:
Why do you want to join an early-stage startup?

Answer:
...
```

Another:

```text
Question:
Tell me about your most challenging project.

Answer:
...
```

Store:

```text
question
answer
category
tone
tags
source
```

Then when a similar question appears:

```text
Current question
       ↓
Search answer library
       ↓
Similar answer found
       ↓
Adapt answer
       ↓
Return
```

This is much better than generating every answer from scratch.

---

# 16. User's tone profile

You specifically mentioned:

> based on my profile and my tone

Create a tone profile.

For example:

```json
{
  "tone": {
    "professional": 0.8,
    "friendly": 0.7,
    "confident": 0.8,
    "casual": 0.3,
    "technical": 0.7
  },
  "preferences": {
    "avoidBuzzwords": true,
    "avoidOverclaiming": true,
    "shortAnswers": true,
    "useFirstPerson": true
  }
}
```

But even better:

Let the system learn from the user's edited answers.

```text
AI answer
     ↓
User edits
     ↓
Save original + edited
     ↓
Compare
     ↓
Learn preferences
```

Eventually:

**the extension starts sounding like the user.**

---

# 17. AI architecture

Don't send your entire database to Mistral every time.

Use retrieval.

```text
Question
   ↓
Classify
   ↓
Retrieve relevant information
   ↓
Build small context
   ↓
Mistral
   ↓
Answer
```

For:

> Tell us about your experience building AI applications.

Retrieve only:

```text
AI projects
Data engineering experience
Relevant skills
Current role
Relevant achievements
Tone profile
```

Not:

```text
phone
address
graduation year
every project
every skill
```

---

# 18. Agentic architecture

You don't actually need a giant autonomous agent.

I would create a small **Application Agent**.

```text
Application Agent
│
├── Page Analyzer
│
├── Field Detector
│
├── Question Classifier
│
├── Profile Retriever
│
├── Resume Retriever
│
├── Answer Library Retriever
│
├── Answer Generator
│
├── Autofill Agent
│
├── Validation Agent
│
└── Learning Agent
```

---

# 19. Example agent workflow

Website asks:

> What is your experience with TypeScript?

### Step 1

Field detector:

```text
field = input
```

### Step 2

Question classifier:

```text
category = technical_experience
skill = TypeScript
```

### Step 3

Retriever:

```text
TypeScript
experience = 2 years
```

### Step 4

Answer planner:

```text
Expected answer type = number/text
```

### Step 5

Return:

```text
2
```

### Step 6

Autofill.

---

# 20. Another example

Question:

> Why are you interested in joining our company?

Now:

```text
Question classifier
       ↓
open_ended_company_interest
       ↓
Retrieve
       ├── user profile
       ├── relevant experience
       ├── company name
       ├── job title
       └── previous answers
       ↓
Mistral
       ↓
Generate
```

Output:

```text
I'm interested in this role because...
```

Then:

```text
[Insert]
[Copy]
[Regenerate]
[Shorter]
[More technical]
```

---

# 21. The "cursor blinking" idea

Your idea is good, but I would **not rely on literally detecting a blinking cursor**.

Instead detect:

```text
focus event
```

When user clicks an input:

```javascript
focusin
```

Your extension knows:

```text
activeElement = input
```

Then:

```text
Analyze active element
```

This is much more reliable.

For example:

```text
User clicks input

       ↓

focusin event

       ↓

Identify element

       ↓

Find associated label/question

       ↓

Understand question

       ↓

Show suggestion
```

---

# 22. Put a small AI button beside fields

This could be your signature UX.

Example:

```text
Why do you want to work here?

┌──────────────────────────────────────┐
│                                      │
│                                      │
└──────────────────────────────────────┘
                               ✨
```

When user clicks ✨:

```text
┌─────────────────────────────┐
│ ✨ Job Copilot              │
│                             │
│ Generating based on your   │
│ profile...                  │
│                             │
│ [answer]                    │
│                             │
│ [Insert] [Copy] [Edit]      │
└─────────────────────────────┘
```

This is much better than constantly injecting UI everywhere.

---

# 23. But there is a big problem

Some websites use:

```text
iframe
Shadow DOM
React
Angular
Vue
custom inputs
contenteditable
virtualized forms
cross-origin iframe
CAPTCHA
```

So you **cannot guarantee 100% autofill on every website**.

That's an important engineering reality.

Instead your product promise should be:

> **Works across the web, with intelligent autofill where supported and a universal AI side panel fallback everywhere the extension can run.**

That is much more defensible.

---

# 24. Build a compatibility engine

Maintain:

```text
website_patterns
```

Example:

```text
Greenhouse
Lever
Workday
Ashby
LinkedIn
Indeed
Tario
SmartRecruiters
iCIMS
Jobvite
etc.
```

For each:

```json
{
  "platform": "Greenhouse",
  "fieldStrategies": [],
  "selectors": [],
  "specialHandlers": []
}
```

But don't make your whole product depend on these adapters.

Use:

```text
Universal detector
       ↓
if confidence high
       ↓
autofill

if special platform
       ↓
platform adapter

if uncertain
       ↓
side panel
```

---

# 25. Confidence engine

This is another critical piece.

Every answer gets:

```text
confidence = 0 → 1
```

Example:

```text
Email address

confidence = 0.99

→ Autofill automatically
```

But:

```text
Tell us about a difficult professional situation

confidence = 0.61

→ Don't autofill
→ Generate suggestion
```

And:

```text
Are you legally authorized to work in the US?

confidence = 0.95

→ Show confirmation
```

For sensitive fields, don't blindly auto-answer.

---

# 26. Three levels of automation

I recommend:

### Level 1 - Safe

```text
Name
Email
Phone
LinkedIn
GitHub
Portfolio
```

Automatically fill.

---

### Level 2 - Review

```text
Years of experience
Education
Skills
Location
Notice period
Salary
```

Show suggestion:

```text
Found answer:

2 years

[Insert]
```

---

### Level 3 - Human approval

```text
Visa
Work authorization
Sponsorship
Criminal record
Demographic questions
Legal questions
Salary expectations
```

Never silently submit.

---

# 27. Side panel should be your "always works" mechanism

This is the most important answer to your problem.

Don't say:

> "Our autofill works everywhere."

Say:

> **"Our assistant works everywhere."**

Autofill is only one capability.

Your architecture:

```text
                EXTENSION
                    │
        ┌───────────┴───────────┐
        │                       │
   AUTOFILL ENGINE        SIDE PANEL
        │                       │
        │                  Always available
        │                       │
        ↓                       ↓
     Best case             Fallback
```

So if:

```text
Workday breaks
```

the user still has:

```text
Side Panel → Detect question → Generate → Copy
```

---

# 28. Page context extraction

When the side panel opens, automatically collect:

```text
URL
page title
company name
job title
visible headings
form labels
questions
selected options
```

For example:

```json
{
  "company": "Tario",
  "role": "AI Product Engineer",
  "questions": [
    "Why do you want to work here?",
    "What is your experience with TypeScript?"
  ]
}
```

Then the user doesn't even need to manually paste the question.

---

# 29. Manual question mode

Still provide:

```text
Paste a question

┌─────────────────────────────┐
│                             │
│                             │
└─────────────────────────────┘

[Generate Answer]
```

This guarantees that your product is usable even when DOM extraction completely fails.

---

# 30. Copy system

Every generated answer should have:

```text
[Copy]
```

And maybe:

```text
[Copy as plain text]
```

This matters because sometimes:

```text
Insert
```

won't work due to React controlled inputs.

So your fallback is:

```text
Copy → Ctrl+V
```

---

# 31. Smart insertion

Normal:

```javascript
element.value = answer
```

is not enough.

React/Vue/Angular may not detect it.

Your insertion layer should support:

```text
native setter
+
input event
+
change event
+
keydown
+
beforeinput
```

And for framework-controlled fields, dispatch the appropriate events after updating the value.

This should be its own module:

```text
InsertionEngine
├── NativeInput
├── ReactInput
├── ContentEditable
├── Textarea
├── Select
├── Checkbox
├── Radio
└── CustomWidget
```

---

# 32. Select fields

Example:

> Highest level of education

Options:

```text
High School
Bachelor's
Master's
PhD
```

Your engine:

```text
question
 ↓
profile.education.degree
 ↓
Bachelor's
 ↓
find matching option
 ↓
select
```

---

# 33. Checkbox

Example:

> I agree that the information provided is accurate.

Do **not** automatically check legal/consent checkboxes.

Instead:

```text
⚠ Review this checkbox
```

That's safer.

---

# 34. Resume selection

This is another excellent feature.

Suppose user has:

```text
Resume
├── AI Product Engineer
├── Data Engineer
├── Full Stack Engineer
└── ML Engineer
```

Job:

```text
AI Product Engineer
```

Extension analyzes:

```text
Job description
       ↓
Resume matcher
       ↓
AI Product Engineer Resume
       ↓
Recommended
```

Then:

```text
✓ Recommended resume

AI Product Engineer - v3

[Use this]
```

---

# 35. Job description extraction

When the user opens a job:

```text
Extension
    ↓
Extract JD
    ↓
Analyze
    ↓
Skills
    ↓
Role
    ↓
Experience
    ↓
Keywords
```

Save:

```text
job
company
role
url
description
skills
location
salary
```

Then connect application history.

---

# 36. This turns the extension into a job application OS

You eventually have:

```text
Job discovered
       ↓
Job saved
       ↓
Job analyzed
       ↓
Best resume selected
       ↓
Application started
       ↓
Questions answered
       ↓
Application submitted
       ↓
Application tracked
```

That is much more valuable than just an autofill extension.

---

# 37. Suggested product architecture

I would structure the repo like this:

```text
job-copilot/
│
├── apps/
│   │
│   ├── extension/
│   │   ├── manifest.json
│   │   │
│   │   ├── background/
│   │   │   └── service-worker.ts
│   │   │
│   │   ├── content/
│   │   │   ├── index.ts
│   │   │   ├── dom-scanner.ts
│   │   │   ├── field-detector.ts
│   │   │   ├── question-parser.ts
│   │   │   ├── autofill-engine.ts
│   │   │   ├── insertion-engine.ts
│   │   │   └── mutation-observer.ts
│   │   │
│   │   ├── sidepanel/
│   │   │   ├── App.tsx
│   │   │   ├── QuestionCard.tsx
│   │   │   └── AnswerCard.tsx
│   │   │
│   │   ├── popup/
│   │   │
│   │   └── adapters/
│   │       ├── greenhouse.ts
│   │       ├── lever.ts
│   │       ├── workday.ts
│   │       └── ashby.ts
│   │
│   └── web/
│       ├── profile
│       ├── resumes
│       ├── jobs
│       └── applications
│
├── packages/
│   ├── ai/
│   ├── profile/
│   ├── retrieval/
│   ├── question-classifier/
│   ├── autofill/
│   └── shared/
│
└── supabase/
    ├── migrations/
    └── functions/
```

---

# 38. Recommended stack for you

Given your existing stack, I wouldn't introduce unnecessary technologies.

### Frontend

```text
Next.js
React
TypeScript
Tailwind
```

### Extension

```text
TypeScript
React
Chrome MV3
```

### Backend

```text
Supabase
Postgres
Supabase Auth
Supabase Storage
```

### AI

```text
Mistral
```

### PDF

```text
PDF text extraction
```

### Search/RAG

Initially:

```text
Postgres + pgvector
```

Later:

```text
hybrid search
```

---

# 39. AI abstraction

Don't write:

```typescript
mistral.generate(...)
```

everywhere.

Instead:

```typescript
interface AIProvider {
  classifyQuestion(input: QuestionInput): Promise<QuestionClassification>;

  generateAnswer(input: AnswerInput): Promise<GeneratedAnswer>;

  extractResume(input: ResumeInput): Promise<ResumeData>;
}
```

Then:

```text
AIProvider
   │
   ├── MistralProvider
   ├── OpenAIProvider
   └── LocalProvider
```

So when Mistral's free limits become insufficient, you don't rewrite your application.

Mistral's current API has organization-level rate/usage limits, with free mode specifically having lower limits for testing/prototyping. ([Mistral AI](https://docs.mistral.ai/admin/billing-usage/usage-limits?utm_source=chatgpt.com))

---

# 40. Don't put your Mistral API key inside the extension

Very important.

Bad:

```text
Extension
   ↓
Mistral API
```

because users can potentially extract the API key.

Instead:

```text
Extension
     ↓
Your API
     ↓
Mistral
```

For an MVP where the user provides their own Mistral key, you can support a BYOK mode, but architect it separately.

Production:

```text
Extension
   ↓
Supabase Edge Function
   ↓
Mistral
```

Mistral API keys are workspace-scoped and tied to the organization's plan/usage, so the server-side design also gives you much better control over quotas and abuse. ([Mistral AI](https://docs.mistral.ai/admin/identity-access/api-keys?utm_source=chatgpt.com))

---

# 41. Privacy architecture

This product handles extremely sensitive information.

You will store:

```text
Resume
Phone
Email
Employment
Education
Salary
Job applications
Work authorization
```

Therefore make privacy a core feature.

I would have:

```text
User
 ↓
Encrypted profile
 ↓
Only retrieve required fields
 ↓
AI
 ↓
Delete temporary context
```

Don't send the entire profile to the model every time.

---

# 42. Local-first architecture

You can make this even better.

Store basic information locally:

```text
chrome.storage.local
```

For example:

```text
name
email
phone
links
basic skills
```

Then cloud stores:

```text
resume
projects
experience
answer library
application history
```

This makes the extension feel extremely fast.

---

# 43. The UX I would build

User installs extension.

First screen:

```text
Welcome to ApplyCopilot

Let's build your application profile.

[Upload Resume]

or

[Enter information manually]
```

Then:

```text
Resume uploaded ✓

We found:

Name       ✓
Email      ✓
Experience ✓
Skills     ✓
Projects   ✓

[Review Profile]
```

---

# 44. Then user opens a job

Extension detects:

```text
AI Product Engineer
Tario
```

Side panel:

```text
┌──────────────────────────────┐
│ AI Product Engineer          │
│ Tario                        │
│                              │
│ Resume                       │
│ ⭐ AI Product Engineer v3    │
│                              │
│ Application                  │
│                              │
│ 14 fields detected           │
│ 9 can autofill               │
│ 3 need review                │
│ 2 AI questions               │
│                              │
│ [Start Autofill]             │
└──────────────────────────────┘
```

This is much better UX than just having a popup.

---

# 45. Autofill dashboard

After clicking:

```text
14 fields detected

✓ First Name
✓ Last Name
✓ Email
✓ Phone
✓ LinkedIn
✓ GitHub
✓ Location
✓ Education
✓ Python experience

⚠ Salary expectation
⚠ Work authorization

✨ Why Tario?
✨ Tell us about your project
```

Then:

```text
[Review & Continue]
```

---

# 46. The killer feature

I'd make this the central experience:

### "Ask anything on this page"

User highlights text:

> What makes you a strong candidate for this role?

Right click:

```text
✨ Ask ApplyCopilot
```

Then side panel automatically generates:

```text
Based on your experience:

...
```

Buttons:

```text
[Copy]
[Insert]
[Shorter]
[More confident]
[More casual]
[Regenerate]
```

This works even if you haven't figured out that website's form structure.

---

# 47. Agent memory

Your system can learn:

```text
Question
↓
Generated answer
↓
User edits answer
↓
User submits
↓
Save final answer
```

Next time:

```text
similar question
↓
retrieve previous answer
↓
adapt
```

Eventually you have:

**Personal Job Application Memory.**

That's a strong moat.

---

# 48. MVP - don't build everything

I would NOT start with:

❌ 50 job websites  
❌ autonomous application submission  
❌ complicated agents  
❌ complex multi-agent system  
❌ browser automation  
❌ huge RAG pipeline

Start with:

### MVP V1

```text
1. Chrome extension
2. User profile
3. Resume upload
4. Resume parser
5. Field detection
6. Basic autofill
7. Side panel
8. Question detection
9. Mistral answer generation
10. Copy button
11. Insert button
```

That's enough to validate the idea.

---

# 49. V1.1

Add:

```text
Answer library
Question history
Tone settings
Resume selection
Job description extraction
```

---

# 50. V1.2

Add:

```text
Greenhouse adapter
Lever adapter
Ashby adapter
Workday adapter
LinkedIn adapter
```

---

# 51. V2

Then:

```text
Job tracking
Application history
Resume matching
Job scoring
Company research
Personalized answers
Application analytics
```

---

# 52. V3

Eventually:

```text
Job discovery
       ↓
Job scoring
       ↓
Resume selection
       ↓
Application
       ↓
AI answers
       ↓
Tracking
       ↓
Follow-up
       ↓
Interview preparation
```

You essentially build a **personal AI job application agent**.

---

# 53. The agentic loop

Your final system can look like:

```text
                    ┌───────────────┐
                    │    JOB PAGE   │
                    └───────┬───────┘
                            ↓
                    PAGE UNDERSTANDING
                            ↓
                     FIELD DETECTION
                            ↓
                     QUESTION QUEUE
                            ↓
              ┌─────────────┴─────────────┐
              ↓                           ↓
        KNOWN FIELD                  UNKNOWN FIELD
              ↓                           ↓
       PROFILE RETRIEVAL             AI CLASSIFIER
              ↓                           ↓
          CONFIDENCE                  RETRIEVAL
              ↓                           ↓
       ┌──────┴──────┐             ANSWER GENERATOR
       ↓             ↓                   ↓
    HIGH          MEDIUM               REVIEW
       ↓             ↓                   ↓
    FILL         SUGGEST              COPY/INSERT
       │             │                   │
       └─────────────┴───────────────────┘
                       ↓
                  USER FEEDBACK
                       ↓
                  MEMORY UPDATE
```

That is the **agentic architecture I would recommend**.

---

# 54. One important product philosophy

Don't make the product:

> **"An autofill extension."**

Make it:

> **"Your AI job application copilot."**

Because autofill is technically hard to guarantee across the web.

But your copilot can always provide:

```text
Detect
→ Understand
→ Retrieve
→ Generate
→ Copy
→ Insert
```

Even if:

```text
Autofill = ❌
```

you still have:

```text
AI answer = ✅
Copy = ✅
```

That's what makes the product resilient.

---

# 55. Your ideal architecture in one picture

```text
                         ┌───────────────────┐
                         │    USER PROFILE   │
                         │                   │
                         │ Resume            │
                         │ Experience        │
                         │ Skills            │
                         │ Projects          │
                         │ Education         │
                         │ Answer Library    │
                         │ Tone              │
                         └─────────┬─────────┘
                                   │
                                   ↓
┌─────────────────────────────────────────────────────┐
│                  CHROME EXTENSION                   │
│                                                     │
│  ┌─────────────┐     ┌─────────────────────────┐   │
│  │ Content     │────→│ Field Understanding     │   │
│  │ Script      │     │                         │   │
│  └─────────────┘     └────────────┬────────────┘   │
│                                   │                │
│                         ┌─────────┴─────────┐      │
│                         ↓                   ↓      │
│                   Known Question       Unknown     │
│                         ↓                   ↓      │
│                   Profile Match         Mistral    │
│                         ↓                   ↓      │
│                     Confidence        Answer       │
│                         │                   │       │
│              ┌──────────┴──────────┐        │       │
│              ↓                     ↓        ↓       │
│           Autofill              Suggest   Generate │
│              │                     │        │       │
│              └─────────────────────┴────────┘       │
│                              ↓                      │
│                        Side Panel                   │
│                       Copy / Insert                 │
└──────────────────────────────┬──────────────────────┘
                               │
                               ↓
                       ┌───────────────┐
                       │   SUPABASE    │
                       │               │
                       │ Profile       │
                       │ Resumes       │
                       │ Jobs          │
                       │ Answers       │
                       │ Applications  │
                       └───────┬───────┘
                               │
                               ↓
                         ┌───────────┐
                         │  MISTRAL  │
                         │    API    │
                         └───────────┘
```

## My recommendation for your build

Since you already work with **TypeScript/React/Next.js/Supabase**, I would build the first version with:

**Chrome MV3 + React + TypeScript + Supabase + Mistral + pgvector**, with the **Side Panel + universal content script** as the foundation.

And the most important engineering principle is:

> **Never make autofill the single point of failure.**

Build **Universal Detection → Autofill when possible → AI Side Panel when not → Copy as the final fallback.**

That gives you a product that can realistically work across arbitrary job websites rather than becoming another extension that only works on 5-10 supported ATS platforms.

Also, because Mistral's current Free mode has usage/rate limits, keep the AI provider behind an abstraction so you can later swap in another model or a user's own API key without rebuilding the extension. ([Mistral AI](https://docs.mistral.ai/admin/billing-usage/usage-limits?utm_source=chatgpt.com))

If I were building this as a real product, **the next step would be to turn this architecture into a concrete implementation plan: database schema → extension folder structure → message/event architecture → field-detection algorithm → Mistral prompts → autofill engine → side-panel UI → MVP milestones**, in the exact order you'd code it.

---

**Sources:**

- [API reference  |  Chrome for Developers](https://developer.chrome.com/docs/extensions/reference/api?utm_source=chatgpt.com)
- [Usage and limits | Mistral Docs](https://docs.mistral.ai/admin/billing-usage/usage-limits?utm_source=chatgpt.com)

## Prompt:
08/09/2026, 18:07:32

what i need for this whchi database and services and techstackm?

## Response:
08/09/2026, 18:07:34

For your product, I’d keep the stack **simple and cheap at V1**. You don't need a huge agentic infrastructure initially.

## Recommended tech stack

| Layer | Technology | Purpose |
|---|---|---|
| Browser extension | **Chrome Extension Manifest V3** | Runs on job/application websites |
| Extension UI | **React + TypeScript** | Popup + Side Panel |
| Extension build | **Vite** | Fast extension development |
| Main web app | **Next.js + TypeScript** | Profile, resumes, applications, settings |
| Database | **Supabase PostgreSQL** | User/profile/job/application data |
| Authentication | **Supabase Auth** | Login/signup |
| File storage | **Supabase Storage** | Resume PDFs |
| Vector search | **pgvector** | Search user's previous answers/projects/experience |
| AI | **Mistral API** | Question classification, resume parsing, answer generation |
| Backend API | **Next.js API routes / Supabase Edge Functions** | Secure AI calls |
| PDF parsing | **Python service/library** initially | Extract resume text |
| Hosting | **Vercel** | Next.js application |
| Extension storage | **chrome.storage.local** | Fast local profile/cache/settings |
| Analytics | **PostHog** or simple DB events | Product analytics |
| Error monitoring | **Sentry** | Extension/web errors |
| Version control | **GitHub** | Source code + CI/CD |

---

# 1. The main database: Supabase PostgreSQL

This should be your **central database**.

You need roughly these tables:

```text
users
profiles
experiences
skills
education
projects
certifications
resumes
resume_versions

answer_library
answer_history

jobs
applications

application_questions
application_answers

user_preferences
tone_profiles

field_mappings
website_adapters

usage
events
```

You don't need all of these on day one.

### MVP database

Start with:

```text
profiles
experiences
skills
education
projects
resumes
answer_library
jobs
applications
application_questions
user_preferences
```

---

# 2. Profile database

Your core user profile could look like:

```text
profiles
-------------------------
id
user_id
first_name
last_name
email
phone
location
linkedin_url
github_url
portfolio_url
current_title
summary
created_at
updated_at
```

This handles the obvious fields.

---

# 3. Experience

```text
experiences
-------------------------
id
user_id
company
job_title
start_date
end_date
description
achievements
technologies
```

Example:

```text
Data Engineer
Company X

Python
SQL
AWS
ETL
Data pipelines
```

---

# 4. Skills

```text
skills
-------------------------
id
user_id
name
years_of_experience
proficiency
last_used
```

Example:

```text
Python | 2 | Advanced
SQL    | 2 | Advanced
React  | 1 | Intermediate
```

This lets your engine answer:

> How many years of Python experience do you have?

without using AI.

---

# 5. Projects

Very important for AI-generated answers.

```text
projects
-------------------------
id
user_id
name
description
problem
solution
impact
technologies
url
```

For example:

```text
Supplierverse.ai

Problem:
...

Solution:
...

Impact:
...

Technologies:
Next.js
TypeScript
Supabase
LLMs
SSE
```

When a company asks:

> Tell us about an AI product you've built.

Your retrieval system can pull this project.

---

# 6. Resume storage

Use:

**Supabase Storage**

rather than putting PDFs directly inside PostgreSQL.

Architecture:

```text
User
 ↓
Upload resume.pdf
 ↓
Supabase Storage
 ↓
resume record in PostgreSQL
```

Database:

```text
resumes
-------------------------
id
user_id
file_path
name
version
parsed_text
created_at
```

---

# 7. Resume processing

When the user uploads:

```text
resume.pdf
```

do:

```text
PDF
 ↓
Text extraction
 ↓
Mistral
 ↓
Structured JSON
 ↓
User review
 ↓
Database
```

Example:

```json
{
  "skills": [
    {
      "name": "Python",
      "years": 2
    }
  ],
  "experience": [],
  "education": [],
  "projects": []
}
```

**Important:** don't automatically overwrite the user's profile with AI extraction. Let the user confirm the extracted information.

---

# 8. Answer Library

This is one of the most valuable tables.

```text
answer_library
-------------------------
id
user_id
question
answer
category
tags
embedding
created_at
updated_at
```

Example:

```text
Question:
Why do you want to work at a startup?

Answer:
I enjoy working in environments...

Category:
Motivation

Tags:
startup
culture
ownership
```

---

# 9. Answer history

You should also store what happened during applications.

```text
answer_history
-------------------------
id
user_id
question
generated_answer
edited_answer
final_answer
source
job_id
created_at
```

This creates your **personal answer memory**.

Later:

```text
New question
     ↓
Search previous answers
     ↓
Find similar question
     ↓
Adapt
     ↓
Generate
```

That's much better than generating from scratch every time.

---

# 10. Jobs database

When the extension sees a job:

```text
jobs
-------------------------
id
user_id
company
title
url
location
description
skills
salary
source
created_at
```

The extension can automatically capture the job description.

---

# 11. Application database

```text
applications
-------------------------
id
user_id
job_id
status
resume_id
applied_at
source
created_at
updated_at
```

Status:

```text
saved
applying
applied
assessment
interview
rejected
offer
withdrawn
```

Eventually this becomes your **job tracker**.

---

# 12. Application questions

This is important for your extension.

```text
application_questions
-------------------------
id
application_id
question
field_type
detected_value
confidence
answer
was_autofilled
was_edited
created_at
```

Example:

```text
Question:
How many years of Python experience?

Type:
technical_experience

Answer:
2

Confidence:
0.98

Autofilled:
true
```

---

# 13. User preferences

```text
user_preferences
-------------------------
user_id
answer_length
tone
auto_fill_level
auto_generate
preferred_resume
```

Example:

```json
{
  "tone": "professional-friendly",
  "answer_length": "short",
  "auto_fill_level": "safe_only"
}
```

---

# 14. Tone profile

Eventually:

```text
tone_profiles
-------------------------
id
user_id
professional
friendly
confident
casual
technical
verbosity
avoid_buzzwords
```

And store examples of their writing.

Then Mistral gets:

```text
User's profile
+
Relevant experience
+
Relevant project
+
Tone profile
+
Example previous answers
```

---

# 15. pgvector

You **should use pgvector**, but don't over-engineer it.

Supabase supports PostgreSQL with pgvector.

Use it for:

```text
Answer similarity
Project retrieval
Experience retrieval
Skill retrieval
Resume sections
Previous application answers
```

Example:

User asks:

> Describe a challenging engineering project.

Vector search finds:

```text
Supplierverse project
```

Then Mistral generates the answer.

---

# 16. Your AI layer

Don't directly couple your extension to Mistral.

Create:

```text
AI Service
```

with:

```typescript
interface AIProvider {
  classifyQuestion(): Promise<...>

  generateAnswer(): Promise<...>

  parseResume(): Promise<...>

  extractJob(): Promise<...>
}
```

Then:

```text
AI Service
    │
    └── Mistral
```

Later:

```text
AI Service
    ├── Mistral
    ├── OpenAI
    ├── Gemini
    └── Local model
```

You can change providers without changing your extension architecture.

---

# 17. Where Mistral should be used

### Don't use AI for:

```text
First name
Last name
Email
Phone
LinkedIn
GitHub
Portfolio
```

Database lookup is enough.

---

### Use AI for:

```text
Question classification
Resume parsing
Job description parsing
Ambiguous fields
Open-ended questions
Behavioral questions
Company-specific questions
Answer rewriting
```

So:

```text
                Question
                   ↓
           ┌───────┴───────┐
           ↓               ↓
       Deterministic       AI
           ↓               ↓
      Known field      Complex question
           ↓               ↓
        Profile          RAG
                           ↓
                         Mistral
```

This keeps costs down.

---

# 18. Chrome extension architecture

Your extension should contain:

```text
extension/
│
├── manifest.json
│
├── background/
│   └── service-worker.ts
│
├── content/
│   ├── index.ts
│   ├── dom-scanner.ts
│   ├── field-detector.ts
│   ├── question-parser.ts
│   ├── mutation-observer.ts
│   ├── autofill-engine.ts
│   └── insertion-engine.ts
│
├── sidepanel/
│   ├── App.tsx
│   ├── QuestionCard.tsx
│   ├── AnswerCard.tsx
│   └── ProfileCard.tsx
│
├── popup/
│   └── App.tsx
│
└── adapters/
    ├── greenhouse.ts
    ├── lever.ts
    ├── workday.ts
    └── ashby.ts
```

---

# 19. The most important extension component

### Content Script

It lives on the webpage.

Its job:

```text
Detect page
 ↓
Detect forms
 ↓
Detect input
 ↓
Detect active input
 ↓
Understand question
 ↓
Ask backend
 ↓
Receive answer
 ↓
Insert answer
```

It should use:

```text
focusin
MutationObserver
DOM traversal
ARIA
labels
placeholders
nearby text
```

---

# 20. Side Panel

The side panel is your **universal fallback**.

It should work independently of autofill.

User can:

```text
Open extension
      ↓
Read current page
      ↓
Extract questions
      ↓
Generate answers
      ↓
Copy
```

Even if:

```text
Autofill ❌
```

you still have:

```text
AI Copilot ✅
```

This is a critical product decision.

---

# 21. Local extension storage

Use:

```text
chrome.storage.local
```

for:

```text
auth token
basic profile cache
settings
last active job
temporary question
UI state
```

Don't store your complete resume/profile there unnecessarily.

---

# 22. Backend architecture

Keep it simple:

```text
Chrome Extension
       │
       ↓
Next.js / API
       │
       ├── Supabase
       │
       └── Mistral
```

For example:

```text
POST /api/ai/question
POST /api/ai/generate
POST /api/resume/parse
POST /api/job/analyze
GET  /api/profile
POST /api/application
```

---

# 23. Authentication

Use:

**Supabase Auth**

Flow:

```text
Extension
   ↓
Login
   ↓
Supabase Auth
   ↓
JWT
   ↓
Extension stores session
```

Then every request contains the authenticated user's identity.

---

# 24. Security

You need **Row Level Security (RLS)** in Supabase.

For example:

```text
User A
 ↓
Can access User A profile

User B
 ↓
Cannot access User A profile
```

This is extremely important because resumes and application information are private.

---

# 25. Services you'll actually need

For MVP:

### Required

**1. GitHub**

Code repository.

**2. Supabase**

```text
Database
Auth
Storage
pgvector
```

**3. Mistral**

AI.

**4. Vercel**

Web/backend hosting.

**5. Chrome Web Store**

Extension distribution.

That's basically enough.

---

### Optional

**6. Sentry**

Error tracking.

**7. PostHog**

Analytics.

**8. Resend**

Email notifications.

You don't need these initially.

---

# 26. Cost-conscious architecture

For your MVP:

```text
Chrome Extension
      │
      ↓
Vercel
      │
      ├───────────────┐
      ↓               ↓
Supabase           Mistral
```

You can keep the initial infrastructure extremely lightweight.

Don't introduce:

```text
❌ Redis
❌ Kafka
❌ Kubernetes
❌ AWS ECS
❌ Pinecone
❌ LangChain
❌ CrewAI
❌ Temporal
❌ Airflow
```

You simply don't need them for V1.

---

# 27. I would actually avoid LangChain initially

Your agent isn't complicated enough to justify it.

Implement your own orchestration:

```typescript
async function processQuestion(question) {

  const classification =
    await classifyQuestion(question);

  const context =
    await retrieveRelevantContext(classification);

  const answer =
    await generateAnswer(question, context);

  return validateAnswer(answer);
}
```

This is easier to debug.

---

# 28. Your actual agent

You only need one orchestrator initially:

```text
ApplicationAgent
```

It coordinates:

```text
PageAnalyzer
FieldDetector
QuestionClassifier
ProfileRetriever
AnswerRetriever
AnswerGenerator
AutofillEngine
Validator
```

Don't build 10 autonomous agents.

---

# 29. Recommended final architecture

```text
                         ┌──────────────┐
                         │   USER       │
                         └──────┬───────┘
                                │
                         Chrome Extension
                                │
              ┌─────────────────┼─────────────────┐
              │                 │                 │
              ↓                 ↓                 ↓
        Content Script      Side Panel         Popup
              │                 │
              └────────┬────────┘
                       ↓
                Application Agent
                       │
       ┌───────────────┼────────────────┐
       ↓               ↓                ↓
 Field Detector   Question Engine   Autofill Engine
       │               │
       └───────┬───────┘
               ↓
          Backend API
               │
       ┌───────┴─────────┐
       ↓                 ↓
   Supabase           Mistral
       │
 ┌─────┼────────────────────┐
 ↓     ↓       ↓       ↓    ↓
Profile Resume Jobs Answers Apps
       │
       ↓
    pgvector
```

---

# 30. What I would build first

### Phase 1 — Foundation

```text
Next.js
Supabase
Chrome MV3
React
TypeScript
Mistral
```

Create:

```text
Authentication
Profile
Resume upload
Database
```

---

### Phase 2 — Extension

Build:

```text
Content script
↓
DOM scanner
↓
Field detector
↓
focus detection
↓
basic autofill
```

At this stage **don't use AI yet**.

Make this work:

```text
Name
Email
Phone
LinkedIn
GitHub
Location
```

---

### Phase 3 — Universal question engine

Build:

```text
Input
 ↓
Extract question
 ↓
Normalize
 ↓
Classify
 ↓
Profile retrieval
```

---

### Phase 4 — Mistral

Add:

```text
Complex question
 ↓
Relevant profile context
 ↓
Mistral
 ↓
Answer
```

---

### Phase 5 — Side Panel

Add:

```text
Question
 ↓
Answer
 ↓
[Copy]
[Insert]
[Regenerate]
```

This is when your **"works on every page" fallback** starts becoming real.

---

### Phase 6 — RAG

Add pgvector:

```text
Question
 ↓
Embedding
 ↓
Relevant projects/experience/answers
 ↓
Mistral
```

---

### Phase 7 — ATS adapters

Only after universal detection works:

```text
Greenhouse
Lever
Ashby
Workday
LinkedIn
Indeed
SmartRecruiters
iCIMS
```

Build adapters only where the generic engine has trouble.

---

## The stack I'd personally choose for you

Given your existing engineering background, my exact choice would be:

```text
                 FRONTEND
                    │
         ┌──────────┴──────────┐
         │                     │
     Next.js               Extension
     React                 React
     TypeScript            TypeScript
         │                     │
         └──────────┬──────────┘
                    ↓
              SUPABASE
         ┌──────────┼──────────┐
         ↓          ↓          ↓
      Postgres     Auth      Storage
         │
      pgvector
         │
         ↓
       AI API
         │
      Mistral
         │
         ↓
       Vercel
```

**You can build the first serious MVP with just 5 core technologies:**

> **TypeScript + React + Chrome MV3 + Supabase + Mistral**

Then add **Next.js/Vercel, pgvector, Sentry and PostHog** as the product grows.

And one thing I'd strongly recommend: **don't build the database around “job websites.” Build it around the user's knowledge.** Websites and ATS platforms will constantly change; your user's profile, resume, experience, projects, answers and preferences are the stable foundation.



---
Powered by [ChatGPT Exporter](https://www.chatgptexporter.com)