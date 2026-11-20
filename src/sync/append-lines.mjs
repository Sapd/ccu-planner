import fs from 'node:fs';
// O_APPEND keeps prior history intact; fsync completes before the resume marker.
// A crash may tear the last line. Separate that tail so later good lines survive;
// parseHistory already ignores malformed lines.
export function appendLines(file, text) {
  const fd = fs.openSync(file, 'a+');
  try {
    const length = fs.fstatSync(fd).size;
    if (length) {
      const last = Buffer.alloc(1); fs.readSync(fd, last, 0, 1, length - 1);
      if (last[0] !== 10 && fs.writeSync(fd, '\n') !== 1) throw new Error('Incomplete history delimiter append');
    }
    for (const line of text.split('\n')) {
      const whole = line + '\n';
      if (fs.writeSync(fd, whole) !== Buffer.byteLength(whole)) throw new Error('Incomplete history line append');
    }
    fs.fsyncSync(fd);
  } finally { fs.closeSync(fd); }
}
