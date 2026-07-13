---
title: Submitting Work
category: workflow
tags: [workflow, submission, beginner]
related: [task-lifecycle, qa-review-process]
---

# Submitting Work

## Before You Submit

### Checklist

1. ✅ **All objects annotated** - No missing vehicles, pedestrians, etc.
2. ✅ **Correct classes** - Each object has right label
3. ✅ **Attributes filled** - Occluded, truncated, etc.
4. ✅ **Tracks complete** - Objects tracked across frames
5. ✅ **Ground alignment** - Boxes touch ground properly
6. ✅ **Tight boxes** - No excess space around objects
7. ✅ **AI QA clean** - No critical errors remaining

### Run AI QA Check

Before submitting, run the AI Quality Check:
1. Click **Run QA Check** button
2. Review any issues found
3. Fix critical and high severity issues
4. Low severity items are OK to leave

## Submitting

1. Review your work one final time
2. Click **Submit for Review** button
3. Confirm submission in dialog
4. Task moves to QA stage

## What Reviewers Check

QA reviewers will verify:
- All required objects are annotated
- Classifications are correct
- Box quality meets standards
- Tracks are accurate and complete
- No duplicate or extra annotations

## After Submission

### If Accepted
- Task moves to next stage
- You may get next task assigned
- Great job!

### If Rejected
- Task returns to you
- Review feedback in comments
- Fix noted issues
- Resubmit when corrected

## Tips for Clean Submissions

1. **Self-review** before submitting
2. **Use AI QA** to catch common issues
3. **Check edge cases** (frame boundaries, occlusions)
4. **Verify tracks** play smoothly
5. **Double-check** difficult objects
