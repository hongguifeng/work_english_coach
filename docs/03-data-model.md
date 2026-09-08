# WorkEnglish Coach 数据模型

## 1. 设计原则

1. 所有数据默认本地保存。
2. 原始工作文本可配置是否保存。
3. 学习记录和知识点应长期保存。
4. 不把 AI 生成结果当成用户已经掌握。
5. 知识点使用稳定的 skillKey 去重。
6. 使用 createdAt 和 updatedAt 记录变化。

---

## 2. 表结构

### 2.1 communication_samples

记录一次工作英语纠错。

字段：

- id
- sourceType：email / instant_message / meeting / report
- audience：colleague / manager / client / supplier / other
- tone：neutral / formal / friendly / firm
- originalChinese，可空
- originalEnglish，可空
- minimalRevision
- naturalRevision
- shouldClarify
- clarificationQuestions，JSON
- createdAt

如果用户选择不保存原文，则 originalChinese 和 originalEnglish 为空，但保留知识点和训练数据。

---

### 2.2 detected_issues

记录一次具体错误。

字段：

- id
- sampleId
- category
- skillKey
- originalText
- correctedText
- explanationZh
- severity：error / suggestion / tone_risk / unclear
- createdAt

---

### 2.3 skills

知识点主表。

字段：

- id
- skillKey，唯一
- title
- category
- explanationZh
- createdAt
- updatedAt

示例：

```text
verb_pattern.need_to
countability.information
preposition.discuss
article.a_an
tone.polite_request
```

---

### 2.4 expressions

表达库。

字段：

- id
- title
- chineseMeaning
- pattern
- example
- scenario
- notes
- sourceSampleId，可空
- masteryStatus：new / learning / familiar
- nextReviewAt
- createdAt
- updatedAt

---

### 2.5 review_tasks

复习任务。

字段：

- id
- taskType：rewrite / transfer / correction / speaking
- skillId，可空
- expressionId，可空
- promptZh
- context
- keywords，JSON
- referenceAnswer
- acceptableAnswers，JSON，可空
- status：pending / completed / skipped
- scheduledAt
- completedAt，可空
- createdAt

---

### 2.6 review_attempts

一次复习尝试。

字段：

- id
- taskId
- userAnswer
- usedHint，布尔值
- revealedAnswer，布尔值
- aiScore，可空
- coreMeaningCorrect，可空
- grammarCorrect，可空
- toneAppropriate，可空
- feedbackZh，可空
- improvedAnswer，可空
- createdAt

---

### 2.7 settings

设置表。

字段：

- key
- value
- updatedAt

API Key 不存这里，应使用系统凭据存储。

---

## 3. 复习调度规则

第一版使用简单间隔：

### 答对且未使用提示

- 第一次：1天后
- 第二次：3天后
- 第三次：7天后
- 第四次：14天后
- 第五次：30天后

### 使用提示后答对

- 1天后重新复习。

### 答错

- 当天或次日复习。
- 不增加掌握等级。

### 查看答案后

- 标记为学习中。
- 1天后重新出现。

### 重要原则

只有"用户独立写出正确表达"才能提升掌握状态。

AI 自动修改的文本不得直接算作掌握。
