import type { Preview } from "@storybook/react-vite";
import "../automation/editorial/ui/style.css";

// 테마는 실제 앱처럼 prefers-color-scheme을 따르고, 툴바에서 강제할 수 있다.
const preview: Preview = {
  globalTypes: {
    theme: {
      description: "색 테마",
      toolbar: { icon: "contrast", items: ["system", "light", "dark"], dynamicTitle: true },
    },
  },
  initialGlobals: { theme: "system" },
  decorators: [
    (Story, { globals }) => {
      const theme = globals.theme as string;
      if (theme === "system") delete document.documentElement.dataset.theme;
      else document.documentElement.dataset.theme = theme;
      return (
        <main>
          <Story />
        </main>
      );
    },
  ],
  parameters: { layout: "fullscreen" },
};
export default preview;
