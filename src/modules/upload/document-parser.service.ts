import { Injectable, Logger } from '@nestjs/common';

const MAX_EXTRACTED_CHARS = 50000;

@Injectable()
export class DocumentParserService {
  private readonly logger = new Logger(DocumentParserService.name);

  async extractText(
    buffer: Buffer,
    filename: string,
    mimeType: string,
  ): Promise<string> {
    const ext = (filename.split('.').pop() || '').toLowerCase();

    try {
      if (mimeType === 'application/pdf' || ext === 'pdf') {
        return await this.parsePdf(buffer);
      }

      if (
        mimeType ===
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
        ext === 'docx'
      ) {
        return await this.parseDocx(buffer);
      }

      if (mimeType === 'application/msword' || ext === 'doc') {
        try {
          return await this.parseDocx(buffer);
        } catch {
          this.logger.warn(`Cannot parse legacy .doc: ${filename}`);
          return '';
        }
      }

      if (
        mimeType ===
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
        mimeType === 'application/vnd.ms-excel' ||
        ext === 'xlsx' ||
        ext === 'xls'
      ) {
        return await this.parseExcel(buffer);
      }

      if (
        mimeType === 'text/plain' ||
        mimeType === 'text/csv' ||
        mimeType === 'text/markdown' ||   // 🆕
        mimeType === 'text/x-markdown' ||  // 🆕
        ext === 'txt' ||
        ext === 'csv' ||
        ext === 'md' ||        // 🆕
        ext === 'markdown'     // 🆕
      ) {
        return this.truncate(buffer.toString('utf-8'));
      }

      this.logger.warn(`Unsupported document type: ${mimeType} (${filename})`);
      return '';
    } catch (err: any) {
      this.logger.error(`Failed to parse ${filename}: ${err.message}`, err.stack);
      return '';
    }
  }

private async parsePdf(buffer: Buffer): Promise<string> {
  this.logger.log(`parsePdf: bufferLen=${buffer?.length}`);

  if (!buffer || buffer.length === 0) return '';

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const pdfParse = require('pdf-parse');
    const data = await pdfParse(buffer);
    const text = this.truncate(data.text || '');
    this.logger.log(`parsePdf: pages=${data.numpages}, textLen=${text.length}`);
    return text;
  } catch (err: any) {
    this.logger.error(`parsePdf FAILED: ${err.message}`, err.stack);
    return '';
  }
}

  private async parseDocx(buffer: Buffer): Promise<string> {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mammoth = require('mammoth');
    const result = await mammoth.extractRawText({ buffer });
    return this.truncate(result.value || '');
  }

  private async parseExcel(buffer: Buffer): Promise<string> {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const XLSX = require('xlsx');
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const parts: string[] = [];

    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName];
      const csv = XLSX.utils.sheet_to_csv(sheet);
      if (csv.trim()) {
        parts.push(`# Лист: ${sheetName}\n${csv}`);
      }
    }

    return this.truncate(parts.join('\n\n'));
  }

  private truncate(text: string): string {
    const cleaned = text.replace(/\n{3,}/g, '\n\n').trim();
    if (cleaned.length <= MAX_EXTRACTED_CHARS) return cleaned;
    return (
      cleaned.slice(0, MAX_EXTRACTED_CHARS) +
      '\n\n[...текст обрезан из-за большого размера]'
    );
  }
}