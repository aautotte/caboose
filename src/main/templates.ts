// Starter files for "New repository". Written for this app.

export const gitignoreTemplates: Record<string, string> = {
  node: ['node_modules/', 'dist/', 'build/', '.env', '.env.*', '!.env.example', 'npm-debug.log*', '.DS_Store', ''].join('\n'),
  python: ['__pycache__/', '*.py[cod]', '.venv/', 'venv/', '.env', 'dist/', 'build/', '*.egg-info/', '.pytest_cache/', '.DS_Store', ''].join('\n'),
  dotnet: ['bin/', 'obj/', '*.user', '.vs/', '*.suo', 'TestResults/', ''].join('\n'),
  general: ['.env', '.DS_Store', 'Thumbs.db', '*.log', ''].join('\n')
}

export function licenseText(id: string, holder: string, year: number): string | null {
  if (id !== 'mit') return null
  // The MIT License text is a standard public licence.
  return `MIT License

Copyright (c) ${year} ${holder}

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
`
}
