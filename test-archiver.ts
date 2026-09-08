import { ZipArchive } from 'archiver';
const archive = new ZipArchive({ zlib: { level: 9 } });
console.log(typeof archive.append);
console.log('success');
