export function formatGenerateCommand(configPath: string, reportId: string): string {
  return `pnpm run local-openfinance run --config ${quoteShellArgument(configPath)} --report ${quoteShellArgument(reportId)}`;
}

function quoteShellArgument(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}
