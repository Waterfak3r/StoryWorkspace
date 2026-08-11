import nextTypescript from "eslint-config-next/typescript";
import nextVitals from "eslint-config-next/core-web-vitals";

const eslintConfig = [
  ...nextVitals,
  ...nextTypescript,
  {
    ignores: [".next/**", "node_modules/**", "next-env.d.ts", ".data/**", ".tmp/**", "coverage/**"],
  },
];

export default eslintConfig;
