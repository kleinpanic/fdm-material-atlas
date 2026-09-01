import { defineConfig } from "html-validate";

export default defineConfig({
  extends: ["html-validate:recommended", "html-validate:document", "html-validate:a11y"],
  rules: {
    "doctype-style": ["error", { style: "lowercase" }],
    "no-raw-characters": "error",
    "require-sri": "off",
  },
});
