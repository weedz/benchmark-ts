# benchmark-ts

## Example:

```typescript
import { runTests, printResults, printResultsTable, TestArray } from "./benchmark";

function cellNumberToName(x: number) {
    let name = "";
    while (x >= 0) {
        name = String.fromCodePoint(x % 26 + 65) + name;
        x = Math.floor(x / 26) - 1;
    }
    return name;
}

const DATA_SIZE = 100000;

const lookups: string[] = [];
for (let i = 0; i < DATA_SIZE; ++i) {
    lookups.push(cellNumberToName(i));
}

function mapAssignment() {
    const map = new Map();
    for (const x of lookups) {
        map.set(x, true);
    }
    return map;
}
function objectAssignment() {
    const object: Record<string, boolean> = {};
    for (const x of lookups) {
        object[x] = true;
    }
    return object;
}

const tests: TestArray = [
    {
        fn: mapAssignment,
        label: "Map assignment"
    },
    {
        fn: objectAssignment,
        label: "Object assignment"
    },
];

const results = runTests(tests);
printResults(results);
printResultsTable(results);
```
