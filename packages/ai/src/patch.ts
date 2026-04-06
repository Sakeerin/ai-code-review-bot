/**
 * Extracts line numbers that were added or modified (Right side)
 * from a unified diff patch string.
 */
export function getModifiedLines(patch: string): number[] {
  const lines = patch.split('\n')
  const modifiedLines: number[] = []
  
  let currentLine = 0
  
  for (const line of lines) {
    // Hunk header: @@ -10,5 +15,7 @@
    if (line.startsWith('@@')) {
      const match = line.match(/@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/)
      if (match) {
        currentLine = parseInt(match[1], 10)
      }
      continue
    }
    
    // Unchanged line
    if (line.startsWith(' ')) {
      currentLine++
      continue
    }
    
    // Added line
    if (line.startsWith('+')) {
      modifiedLines.push(currentLine)
      currentLine++
      continue
    }
    
    // Deleted line (does not advance right-side line number)
    if (line.startsWith('-')) {
      continue
    }
  }
  
  return modifiedLines
}
