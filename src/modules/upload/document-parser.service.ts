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

    this.logger.log(
      `Extracting: ${filename} | mime=${mimeType} | ext=${ext} | size=${buffer.length}b`,
    );

    try {
      let text = '';

      if (mimeType === 'application/pdf' || ext === 'pdf') {
        text = await this.parsePdf(buffer);
      } else if (
        mimeType ===
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
        ext === 'docx'
      ) {
        text = await this.parseDocx(buffer);
      } else if (mimeType === 'application/msword' || ext === 'doc') {
        try {
          text = await this.parseDocx(buffer);
        } catch {
          this.logger.warn(`Cannot parse legacy .doc: ${filename}`);
          text = '';
        }
      } else if (
        mimeType ===
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
        mimeType === 'application/vnd.ms-excel' ||
        ext === 'xlsx' ||
        ext === 'xls'
      ) {
        text = await this.parseExcel(buffer);
      } else if (
        mimeType === 'text/plain' ||
        mimeType === 'text/csv' ||
        ext === 'txt' ||
        ext === 'csv'
      ) {
        text = this.truncate(buffer.toString('utf-8'));
      } else {
        this.logger.warn(`Unsupported document type: ${mimeType} (${filename})`);
        return '';
      }

      this.logger.log(
        `Extracted from ${filename}: ${text.length} chars (hasText=${text.length > 0})`,
      );
      return text;
    } catch (err: any) {
      // ⚠️ Логируем stack — без него реальную причину PDF-ошибки не видно
      this.logger.error(
        `Failed to parse ${filename}: ${err.message}`,
        err.stack,
      );
      return '';
    }
  }

  private async parsePdf(buffer: Buffer): Promise<string> {
    // ✅ ВАЖНО: импортируем внутренний файл, а не корневой index.js,
    //    иначе pdf-parse исполняет debug-блок и падает с ENOENT
    //    при попытке прочитать ./test/data/05-versions-space.pdf
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const pdfParse = require('pdf-parse/lib/pdf-parse.js');
    const data = await pdfParse(buffer);
    const text = this.truncate(data.text || '');

    if (!text) {
      this.logger.warn(
        `PDF parsed but no text extracted (pages=${data.numpages}). ` +
          `Возможно это скан/изображение без текстового слоя.`,
      );
    }
    return text;
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