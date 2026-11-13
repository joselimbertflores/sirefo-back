import { BadRequestException, Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import axios, { AxiosError, AxiosRequestConfig } from 'axios';
import { XMLParser } from 'fast-xml-parser';

import { ConsultRequestDto, ItemRequestDto, PingDto, ItemFundTransferDto, FilterAsfiRequestList } from '../dtos';
import { SOAP_ACTIONS } from '../constants';

import { XmlService } from './xml.service';
import { AsfiFundTransferWithFile, AsfiRequestWithFile } from 'src/modules/prisma/types';
import {
  consultarEstadoEnvioResponse,
  listaEntidadVigenteResponse,
  remitirRemisionFondosResponse,
  remitirSolicitudResponse,
  IAsfiCredentials,
} from '../infrastructure';

@Injectable()
export class SirefoService {
  private readonly ASFI_URL = this.configService.get('ASFI_ENDPOINT');

  constructor(
    private xmlService: XmlService,
    private configService: ConfigService,
  ) {}

  async ping({ message }: PingDto) {
    try {
      const xml = this.xmlService.generateXmlForPing(message);
      const config: AxiosRequestConfig = {
        url: this.ASFI_URL,
        headers: {
          'Content-Type': 'text/xml; charset=utf-8',
          SOAPAction: SOAP_ACTIONS.PING,
        },
        data: xml,
      };
      const response = await axios(config);
      const parsed = this.parseXMLResponse(response.data);
      return {
        message: parsed['Envelope']['Body']['PingResponse']['PingResult'],
      };
    } catch (error) {
      throw new InternalServerErrorException();
    }
  }

  async consultarCabecera(credentials: IAsfiCredentials) {
    try {
      const xml = this.xmlService.generateXmlConsultarCabecera(credentials);
      const config: AxiosRequestConfig = {
        headers: {
          'Content-Type': 'text/xml; charset=utf-8',
          SOAPAction: SOAP_ACTIONS.CONSULTAR_CABECERA,
        },
      };
      const response = await axios.post(this.ASFI_URL, xml, config);
      const parsed = this.parseXMLResponse(response.data);
      return parsed;
    } catch (error) {
      if (error instanceof AxiosError && error.code === 'ERR_BAD_RESPONSE') {
        const data = this.parseXMLResponse(error.response?.data);
        if (data['Envelope']['Body']['Fault']['faultcode'] === 's:Client') {
          throw new BadRequestException('Credenciales ASFI incorrectas');
        }
      }
      throw new InternalServerErrorException('Error al consultar cabeceras');
    }
  }

  async consultarEntidadVigente(credentials: IAsfiCredentials) {
    const xml = this.xmlService.generateXmlForConsultarEntidadVigente(credentials);
    const config: AxiosRequestConfig = {
      headers: {
        'Content-Type': 'text/xml; charset=utf-8',
        SOAPAction: SOAP_ACTIONS.CONSULTAR_ENTIDAD_VIGENTE,
      },
    };

    try {
      const response = await axios.post(this.ASFI_URL, xml, config);
      const parsed: listaEntidadVigenteResponse = this.parseXMLResponse(response.data);
      return parsed['Envelope']['Body']['ListaEntidadVigente']['EntidadVigente'];
    } catch (error) {
      throw new InternalServerErrorException();
    }
  }

  async remitirSolicitud(item: AsfiRequestWithFile, details: ItemRequestDto[], credentials: IAsfiCredentials) {
    const xml = await this.xmlService.generateXmlRemitirSolicitud(item, details, credentials);
    // const outputPath = path.resolve(__dirname, '..', '..', '..', '..', 'assets', `${item.id}-remitir_solicitud.xml`);
    // fs.writeFileSync(outputPath, xml, 'utf8');
    const config: AxiosRequestConfig = {
      method: 'POST',
      url: this.ASFI_URL,
      headers: {
        'Content-Type': 'text/xml; charset=utf-8',
        SOAPAction: SOAP_ACTIONS.REMITIR_SOLICITUD,
      },
      data: xml,
    };

    const response = await axios(config);
    const parsed: remitirSolicitudResponse = this.parseXMLResponse(response.data);
    return parsed.Envelope.Body.EstadoEnvio;
  }

  async remitirRemisionFondos(
    item: AsfiFundTransferWithFile,
    details: ItemFundTransferDto[],
    credentials: IAsfiCredentials,
  ) {
    const xml = await this.xmlService.generateXmlRemitirRemisionFondos(item, details, credentials);
    const config: AxiosRequestConfig = {
      method: 'POST',
      url: this.ASFI_URL,
      headers: {
        'Content-Type': 'text/xml; charset=utf-8',
        SOAPAction: SOAP_ACTIONS.REMITIR_REMISION_FONDOS,
      },
      data: xml,
    };
    const response = await axios(config);
    const parsed: remitirRemisionFondosResponse = this.parseXMLResponse(response.data);
    return parsed.Envelope.Body.EstadoEnvio;
  }

  async consultarListaEstadoEnvio(credentials: IAsfiCredentials, { date }: FilterAsfiRequestList) {
    try {
      const xml = this.xmlService.generateXmlConsultarListaEstadoEnvio(credentials, date);
      const config: AxiosRequestConfig = {
        method: 'POST',
        url: this.ASFI_URL,
        headers: {
          'Content-Type': 'text/xml; charset=utf-8',
          SOAPAction: SOAP_ACTIONS.CONSULTAR_LISTADO_ESTADOS,
        },
        data: xml,
      };

      const response = await axios(config);
      const parset = this.parseXMLResponse(response.data);
      return parset['Envelope']['Body']['ListaEstadoSolicitud']['EstadoConsultaEnvio'];
    } catch (error) {
      console.error('❌ Error en consultarListaEstadoEnvio:', error);
      throw new InternalServerErrorException('Error al consultar lista de estado de envío');
    }
  }

  async consultarEstadoEvio({ id, type }: ConsultRequestDto, credentials: IAsfiCredentials) {
    try {
      const xml = this.xmlService.generateXmlConsultarEstadoEvio(id, type, credentials);
      const config: AxiosRequestConfig = {
        url: this.ASFI_URL,
        method: 'POST',
        data: xml,
        headers: {
          'Content-Type': 'text/xml; charset=utf-8',
          SOAPAction: SOAP_ACTIONS.CONSULTAR_ESTADO_ENVIO,
        },
      };
      const response = await axios(config);
      const parsed: consultarEstadoEnvioResponse = this.parseXMLResponse(response.data);
      return parsed.Envelope.Body.EstadoDeSolicitud;
    } catch (error) {
      throw new InternalServerErrorException();
    }
  }

  private parseXMLResponse(xml: string) {
    const parser = new XMLParser({ removeNSPrefix: true });
    const jsonObj = parser.parse(xml);
    return jsonObj;
  }
}
