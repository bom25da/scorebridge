import { unzipSync } from "fflate";
import { XMLParser, XMLValidator } from "fast-xml-parser";
export function musicXml(buffer: Buffer): string {
  let xml: string;
  if (buffer[0] === 80 && buffer[1] === 75) {
    if (buffer.length > 20 * 1024 * 1024)
      throw new Error("압축 악보가 너무 큽니다.");
    // ZIP central directory sizes are checked before decompression.
    let entries = 0,
      total = 0;
    for (let i = 0; i < buffer.length - 46; i++)
      if (buffer.readUInt32LE(i) === 0x02014b50) {
        entries++;
        total += buffer.readUInt32LE(i + 24);
        i +=
          45 +
          buffer.readUInt16LE(i + 28) +
          buffer.readUInt16LE(i + 30) +
          buffer.readUInt16LE(i + 32);
      }
    if (entries > 100 || total > 30 * 1024 * 1024)
      throw new Error("압축 해제 한도를 초과했습니다.");
    const files = unzipSync(buffer);
    const parser = new XMLParser({ ignoreAttributes: false });
    const container = files["META-INF/container.xml"];
    const roots = container
      ? parser.parse(Buffer.from(container).toString())?.container?.rootfiles
          ?.rootfile
      : undefined;
    const root = Array.isArray(roots) ? roots[0] : roots;
    const name =
      root?.["@_full-path"] ||
      Object.keys(files).find(
        (k) => /\.(xml|musicxml)$/.test(k) && !k.startsWith("META-INF/"),
      );
    if (!name || !files[name])
      throw new Error("압축 악보에 MusicXML이 없습니다.");
    xml = Buffer.from(files[name]).toString("utf8");
  } else xml = buffer.toString("utf8");
  if (xml.length > 30 * 1024 * 1024 || /<!ENTITY/i.test(xml))
    throw new Error("지원하지 않는 XML 참조입니다.");
  // Audiveris may emit a standard MusicXML DOCTYPE; remove it, never resolve it.
  xml = xml.replace(/<!DOCTYPE[^>]*>/gi, "");
  if (XMLValidator.validate(xml) !== true)
    throw new Error("올바르지 않은 MusicXML입니다.");
  const score = new XMLParser({ ignoreAttributes: false }).parse(xml);
  if (!score["score-partwise"]?.part)
    throw new Error("음표가 포함된 악보를 찾지 못했습니다.");
  return xml;
}
