import { Body, Controller, Get, Global, Module, Param, Post, Query, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Public, RequirePermission } from '../../platform/http/decorators';
import { Problem } from '../../platform/http/problem';
import { FileService } from './file.service';

@ApiTags('files')
@Controller('files')
export class FileController {
  constructor(private readonly files: FileService) {}

  @Post()
  @RequirePermission('files.upload')
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' }, purpose: { type: 'string' } } } })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }))
  async upload(@UploadedFile() file: Express.Multer.File | undefined, @Body('purpose') purpose?: string) {
    if (!file) throw Problem.badRequest('Attach a file in the "file" field');
    const f = await this.files.upload({ data: file.buffer, filename: file.originalname, mimeType: file.mimetype, purpose });
    return { id: f.id, filename: f.filename, mimeType: f.mimeType, sizeBytes: f.sizeBytes, url: this.files.signedPath(f.id) };
  }

  @Get(':id')
  @RequirePermission('files.read')
  async meta(@Param('id') id: string) {
    const f = await this.files.meta(id);
    return { ...f, url: this.files.signedPath(f.id) };
  }

  @Get(':id/content')
  @Public()
  async content(@Param('id') id: string, @Query('exp') exp: string, @Query('sig') sig: string, @Res() res: Response) {
    this.files.verifyLink(id, Number(exp), sig);
    const { meta, data } = await this.files.read(id);
    res.setHeader('Content-Type', meta.mimeType);
    res.setHeader('Content-Disposition', `inline; filename="${meta.filename.replace(/"/g, '')}"`);
    res.send(data);
  }
}

@Global()
@Module({ controllers: [FileController], providers: [FileService], exports: [FileService] })
export class FileStorageModule {}
