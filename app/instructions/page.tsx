import EnglishGuide from "./en.mdx";
import ChineseGuide from "./zh.mdx";
import { GuideContent } from "./GuideContent";

export default function InstructionsPage() {
  return <GuideContent en={<EnglishGuide />} zh={<ChineseGuide />} />;
}
