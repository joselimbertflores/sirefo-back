import {
  Injectable,
  HttpException,
  NotFoundException,
  ConflictException,
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';

import { Prisma, User } from 'generated/prisma';

import { SirefoService } from './sirefo.service';
import { CreateAsfiRequestDto, FilterAsfiRequestDto, ItemRequestDto, UpdateAsfiRequestDto } from '../dtos';
import { PrismaService } from 'src/modules/prisma/prisma.service';
import { FilesService } from 'src/modules/files/files.service';
import { AsfiRequestWithFile } from 'src/modules/prisma/types';
import { IAsfiCredentials } from '../infrastructure';

@Injectable()
export class AsfiRequestService {
  constructor(
    private prisma: PrismaService,
    private sirefoService: SirefoService,
    private fileService: FilesService,
  ) {}

  async create(requestDto: CreateAsfiRequestDto, user: User, credentials: IAsfiCredentials) {
    try {
      const { details, file, requestCode, ...props } = requestDto;
      const citeCode = this.buildCiteCode(requestCode);
      await this.checkDuplicateRequestCode(citeCode);
      const currentDate = new Date();
      const createdRequest = await this.prisma.asfiRequest.create({
        data: {
          ...props,
          user: {
            connect: {
              id: user.id,
            },
          },
          requestCode: citeCode,
          quantityDetail: details.length,
          sentDate: currentDate,
          userName: credentials.email,
          file: {
            create: {
              fileName: file.fileName,
              originalName: file.originalName,
            },
          },
        },
        include: { file: true },
      });

      const result = await this.sendAsfiRequest(createdRequest, requestDto.details, credentials);
      return this.plainAsfiRequest(result);
    } catch (error) {
      console.log('Error creacion asfi request', error);
      if (error instanceof HttpException) throw error;
      throw new InternalServerErrorException();
    }
  }

  async update(id: string, requestDto: UpdateAsfiRequestDto, credentials: IAsfiCredentials) {
    try {
      const { file, details, requestCode, ...dtoProps } = requestDto;
      const requesDB = await this.prisma.asfiRequest.findUnique({ where: { id }, include: { file: true } });
      if (!requesDB) throw new NotFoundException(`Request ${id} not found`);

      if (requesDB.status !== 'draft' && requesDB.status !== 'rejected') {
        throw new BadRequestException(`Request must be pending status for update`);
      }

      const citeCode = requestCode ? this.buildCiteCode(requestCode) : null;

      if (citeCode && citeCode !== requesDB.requestCode) {
        await this.checkDuplicateRequestCode(citeCode);
      }

      const updatedRequest = await this.prisma.$transaction(async (tx) => {
        let createFileQuery: Prisma.AsfiRequestUpdateInput = {};
        if (file && requesDB.file.fileName !== file.fileName) {
          createFileQuery = {
            file: {
              create: {
                fileName: file.fileName,
                originalName: file.originalName,
              },
            },
          };
          await tx.asfiRequestFile.deleteMany({ where: { asfiRequestId: id } });
        }
        const updatedRequest = await tx.asfiRequest.update({
          where: { id },
          include: { file: true },
          data: { ...dtoProps, ...createFileQuery, ...(citeCode && { requestCode: citeCode }) },
        });
        return updatedRequest;
      });

      const result = await this.sendAsfiRequest(updatedRequest, details, credentials);

      return this.plainAsfiRequest(result);
    } catch (error) {
      console.log('Error actualizacion asfi request', error);
      if (error instanceof HttpException) throw error;
      throw new InternalServerErrorException();
    }
  }

  async findAll({ limit, offset, term, createdAt, processType, status }: FilterAsfiRequestDto, user: User) {
    const where: Prisma.AsfiRequestWhereInput = {
      userId: user.id,
      ...(term && {
        requestCode: {
          contains: term,
          mode: 'insensitive',
        },
      }),
      ...(createdAt && {
        createdAt: {
          gte: new Date(createdAt.setHours(0, 0, 0, 0)),
          lt: new Date(createdAt.setHours(23, 59, 59, 999)),
        },
      }),
      ...(processType && { processType }),
      ...(status && { status }),
    };
    const [requests, length] = await Promise.all([
      this.prisma.asfiRequest.findMany({
        where,
        skip: offset,
        take: limit,
        include: { file: true },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.asfiRequest.count({ where }),
    ]);
    return {
      requests: requests.map((request) => this.plainAsfiRequest(request)),
      length,
    };
  }

  async searchAprovedCodes(term?: string) {
    const item = await this.prisma.asfiRequest.findMany({
      where: {
        status: 'accepted',
        circularNumber: { not: null },
        processType: 'R',
        ...(term && {
          OR: [
            { requestCode: { contains: term, mode: 'insensitive' } },
            { circularNumber: { contains: term, mode: 'insensitive' } },
          ],
        }),
      },
      select: { id: true, circularNumber: true, requestCode: true, quantityDetail: true },
      take: 5,
    });
    return item;
  }

  private buildCiteCode(requestCode: number) {
    const year = new Date().getFullYear();
    return `CE/SF-DRT-38/${requestCode}/${year}`;
  }

  private async checkDuplicateRequestCode(code: string): Promise<void> {
    const duplicate = await this.prisma.asfiRequest.findFirst({ where: { requestCode: code } });
    if (duplicate) throw new BadRequestException(`El codigo ${code} ya ha sido registrado`);
  }

  private async sendAsfiRequest(
    request: AsfiRequestWithFile,
    details: ItemRequestDto[],
    credentials: IAsfiCredentials,
  ) {
    const response = await this.sirefoService.remitirSolicitud(request, details, credentials);

    if (response.Respuesta !== 0) {
      throw new ConflictException({ message: response.Detalle, request: this.plainAsfiRequest(request) });
    }
    const updated = await this.prisma.asfiRequest.update({
      where: { id: request.id },
      data: { status: 'sent' },
      include: { file: true },
    });
    return updated;
  }

  private plainAsfiRequest(request: AsfiRequestWithFile) {
    const { file, dataSheetFile, ...props } = request;
    return {
      ...props,
      dataSheetFile: this.fileService.buildFileUrl(dataSheetFile),
      file: {
        originalName: file.originalName,
        fileName: this.fileService.buildFileUrl(file.fileName),
      },
    };
  }
}
