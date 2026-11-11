/** @type {import("dependency-cruiser").IConfiguration} */
module.exports = {
  forbidden: [
    { name: "no-circular", severity: "error", from: {}, to: { circular: true } },
    { name: "no-unresolved", severity: "error", from: {}, to: { couldNotResolve: true } },
    {
      name: "independent-runtime",
      severity: "error",
      from: { path: "^automation/" },
      to: { path: "^[.][.]/", pathNot: "^[.][.]/paseo/sdk[.]mjs$" },
    },
    {
      name: "browser-no-runtime",
      severity: "error",
      from: { path: "^automation/editorial/ui/" },
      to: {
        path: "^automation/(editorial/(?!ui/)|paseo/|n8n/)",
        dependencyTypesNot: ["type-only"],
      },
    },
    {
      name: "browser-no-node",
      severity: "error",
      from: { path: "^automation/editorial/ui/" },
      to: { dependencyTypes: ["core"], dependencyTypesNot: ["type-only"] },
    },
    {
      name: "runtime-no-browser",
      severity: "error",
      from: { path: "^automation/", pathNot: "/ui/|/tests/" },
      to: { path: "^automation/editorial/ui/" },
    },
    {
      name: "contracts-independent",
      severity: "error",
      from: { path: "^automation/contracts/" },
      to: { path: "^automation/(?!contracts/)" },
    },
    {
      name: "domain-no-adapters",
      severity: "error",
      from: { path: "^automation/editorial/domain/" },
      to: { path: "^automation/(?!editorial/domain/|contracts/)" },
    },
    {
      name: "domain-no-io",
      severity: "error",
      from: { path: "^automation/editorial/domain/" },
      to: { dependencyTypes: ["core"], dependencyTypesNot: ["type-only"] },
    },
    {
      name: "editorial-no-execution-adapters",
      severity: "error",
      from: { path: "^automation/editorial/", pathNot: "/tests/" },
      to: { path: "^automation/(paseo|n8n|runtime)/" },
    },
    {
      name: "editorial-public-interface-only",
      severity: "error",
      from: { path: "^automation/", pathNot: "^automation/editorial/|/tests/" },
      to: {
        path: "^automation/editorial/",
        pathNot: "^automation/editorial/(index[.]mjs|domain/index[.]mjs)$",
      },
    },
    {
      name: "paseo-public-interface-only",
      severity: "error",
      from: { path: "^automation/", pathNot: "^automation/paseo/|/tests/" },
      to: { path: "^automation/paseo/", pathNot: "^automation/paseo/index[.]mjs$" },
    },
    {
      name: "n8n-no-business-policies",
      severity: "error",
      from: { path: "^automation/n8n/", pathNot: "/tests/|/testing/" },
      to: { path: "^automation/(editorial|paseo|runtime|contracts)/" },
    },
    {
      name: "cli-http-contract-only",
      severity: "error",
      from: { path: "^automation/cli/", pathNot: "/tests/" },
      to: { path: "^automation/(?!cli/|contracts/)" },
    },
    {
      name: "production-no-tests",
      severity: "error",
      from: {
        path: "^automation/",
        pathNot: "/tests/|/testing/|^automation/paseo/(pilot|article-e2e|contract-e2e)[.]mjs$",
      },
      to: { path: "/tests/|/testing/" },
    },
  ],
  options: {
    parser: "swc",
    tsConfig: { fileName: "tsconfig.json" },
    doNotFollow: { path: "node_modules|^[.][.]/paseo/" },
    exclude: { path: "^[.]local/" },
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "node", "default"],
    },
  },
};
