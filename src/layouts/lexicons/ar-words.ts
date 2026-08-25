/** Common Arabic tokens that must stay as typed. Forward remap only onto a hit. */
const ARABIC_WORDS = `
في من على الى إلى أن ان لا ما هل نعم هو هي هم هن أنا انا أنت انت نحن
كان كانت يكون تكون هذا هذه ذلك تلك الذي التي الذين بعد قبل عند بين
تحت فوق مع أو او ثم قد لقد لم لن ليس ليست سوف يجب يمكن قال قالت يقول
كل جميع بعض غير أكثر اكثر جدا كيف ماذا اين أين متى لماذا لان لأن
إذا اذا لكن أيضا ايضا مرحبا شكرا عفوا السلام عليكم أهلا اهلا
التصميم استخدمت دقتها الاداة دقيقة تدعم تستخدم يستخدمها المستخدم
اللغات اللغة جهاز جهازه حالك بخير افعل شيء شيئ كول خرة معفن يا
و وتدعم تكون يجب ان دقيقة جميع التي في لا افعل
الآن الان اليوم جديد جديدة المشروع يعمل تعمل أستخدم استخدم
نص عربي صحيح صديق هنا هناك نعم صباحا مساء
`

function normalizeArabic(word: string): string {
  return word
    .normalize('NFC')
    .replace(/[\u064B-\u065F\u0670\u0640]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
}

const ARABIC_WORD_SET = new Set(
  ARABIC_WORDS.split(/\s+/)
    .filter(Boolean)
    .map((word) => normalizeArabic(word)),
)

export function isArabicWord(word: string): boolean {
  return ARABIC_WORD_SET.has(normalizeArabic(word))
}
