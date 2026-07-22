import {
  Injectable,
  HttpException,
  NotFoundException,
  ConflictException,
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import { AsfiRequest, Prisma, User } from 'generated/prisma';

import { AsfiFundTransferWithFile } from 'src/modules/prisma/types';
import { PrismaService } from 'src/modules/prisma/prisma.service';
import { FilesService } from 'src/modules/files/files.service';

import { SirefoService } from './sirefo.service';
import {
  CreateAsfiFundTransferDto,
  UpdateAsfiFundTransferDto,
  FilterAsfiRequestDto,
  ItemFundTransferDto,
} from '../dtos';
import { IAsfiCredentials } from '../infrastructure';

@Injectable()
export class AsfiFundTransferService {
  constructor(
    private prisma: PrismaService,
    private sirefoService: SirefoService,
    private fileService: FilesService,
  ) {}

  async create(requestDto: CreateAsfiFundTransferDto, user: User, credentials: IAsfiCredentials) {
    try {
      await this.checkTransferCodes(requestDto.details, credentials);

      const { asfiRequestId, requestCode, details, ...dtoProps } = requestDto;

      const citeCode = this.buildCiteCode(requestCode);

      await this.checkDuplicateRequestCode(citeCode);

      const asfiRequest = await this.getValidatedAsfiRequest(asfiRequestId);

      const currentDate = new Date();

      const createdRequest = await this.prisma.asfiFundTransfer.create({
        data: {
          ...dtoProps,
          user: {
            connect: {
              id: user.id,
            },
          },
          requestCode: citeCode,
          quantityDetail: details.length,
          sentDate: currentDate,
          userName: credentials.email,
          asfiRequest: {
            connect: {
              id: asfiRequest.id,
            },
          },
          file: {
            create: {
              fileName: dtoProps.file.fileName,
              originalName: dtoProps.file.originalName,
            },
          },
        },
        include: { file: true, asfiRequest: true },
      });

      const result = await this.sendAsfiRequest(createdRequest, requestDto.details, credentials);
      return this.plainAsfiFundRequest(result);
    } catch (error) {
      console.log('Error creacion asfi transfer request', error);
      if (error instanceof HttpException) throw error;
      throw new InternalServerErrorException();
    }
  }

  async update(id: string, requestDto: UpdateAsfiFundTransferDto, credentials: IAsfiCredentials) {
    try {
      const { file, details, requestCode, asfiRequestId, ...dtoProps } = requestDto;
      await this.checkTransferCodes(details, credentials);

      const requestDB = await this.prisma.asfiFundTransfer.findUnique({ where: { id }, include: { file: true } });
      if (!requestDB) throw new NotFoundException(`Request ${id} not found`);

      if (requestDB.status !== 'draft' && requestDB.status !== 'rejected') {
        throw new BadRequestException(`Request must be pending status for update`);
      }

      const citeCode = requestCode ? this.buildCiteCode(requestCode) : null;

      if (citeCode && citeCode !== requestDB.requestCode) {
        await this.checkDuplicateRequestCode(citeCode);
      }

      const updateAsfiRequestQuery =
        asfiRequestId && asfiRequestId !== requestDB.asfiRequestId
          ? { asfiRequest: { connect: { id: (await this.getValidatedAsfiRequest(asfiRequestId)).id } } }
          : {};

      const updatedRequest = await this.prisma.$transaction(async (tx) => {
        let createFileQuery: Prisma.AsfiFundTransferUpdateInput = {};
        if (file && requestDB.file.fileName !== file.fileName) {
          await tx.asfiTransferFile.deleteMany({ where: { asfiFundTransferId: id } });
          createFileQuery = {
            file: {
              create: {
                fileName: file.fileName,
                originalName: file.originalName,
              },
            },
          };
        }
        const updatedRequest = await tx.asfiFundTransfer.update({
          where: { id },
          include: { file: true, asfiRequest: true },
          data: {
            ...dtoProps,
            ...createFileQuery,
            ...updateAsfiRequestQuery,
            ...(citeCode && { requestCode: citeCode }),
          },
        });
        return updatedRequest;
      });
      const result = await this.sendAsfiRequest(updatedRequest, details, credentials);
      return this.plainAsfiFundRequest(result);
    } catch (error) {
      console.log('Error actualizacion asfi transfer request', error);
      if (error instanceof HttpException) throw error;
      throw new InternalServerErrorException();
    }
  }

  async findAll({ limit, offset, term, createdAt, processType, status }: FilterAsfiRequestDto, user: User) {
    const where: Prisma.AsfiFundTransferWhereInput = {
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
      this.prisma.asfiFundTransfer.findMany({
        where,
        include: {
          file: true,
          asfiRequest: true,
        },
        skip: offset,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.asfiFundTransfer.count({ where }),
    ]);
    return {
      requests: requests.map((request) => this.plainAsfiFundRequest(request)),
      length,
    };
  }

  private async checkTransferCodes(items: ItemFundTransferDto[], credentials: IAsfiCredentials) {
    const entities = await this.sirefoService.consultarEntidadVigente(credentials);
    const validCodes = new Set(entities.map((e) => e.CodigoEnvio));

    const invaliCodes = items
      .filter((item) => !validCodes.has(item.transferCode.toUpperCase()))
      .map(({ transferCode }) => transferCode);

    if (invaliCodes.length > 0) {
      throw new BadRequestException(`Códigos de envío inválidos: ${[...new Set(invaliCodes)].join(', ')}`);
    }
  }

  private async checkDuplicateRequestCode(code: string): Promise<void> {
    const duplicate = await this.prisma.asfiFundTransfer.findFirst({ where: { requestCode: code } });
    if (duplicate) throw new BadRequestException(`El codigo ${code} ya ha sido registrado`);
  }

  private async getValidatedAsfiRequest(id: string): Promise<AsfiRequest> {
    const asfiRequest = await this.prisma.asfiRequest.findFirst({ where: { id } });
    if (!asfiRequest) {
      throw new NotFoundException(`Request ${id} not found`);
    }

    if (!asfiRequest.circularNumber) {
      throw new BadRequestException(`La solicitud ${asfiRequest.requestCode} no tiene un número de circular`);
    }

    return asfiRequest;
  }

  private async sendAsfiRequest(
    request: AsfiFundTransferWithFile,
    details: ItemFundTransferDto[],
    credentials: IAsfiCredentials,
  ) {
    const response = await this.sirefoService.remitirRemisionFondos(request, details, credentials);

    if (response.Respuesta !== 0) {
      throw new ConflictException({ message: response.Detalle, request: this.plainAsfiFundRequest(request) });
    }
    return await this.prisma.asfiFundTransfer.update({
      where: { id: request.id },
      data: { status: 'sent' },
      include: { file: true, asfiRequest: true },
    });
  }

  private plainAsfiFundRequest(request: AsfiFundTransferWithFile) {
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

  private buildCiteCode(requestCode: number) {
    const year = new Date().getFullYear();
    return `CE/SF-DRT-38/${requestCode}/${year}`;
  }
}
