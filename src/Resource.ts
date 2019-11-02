import { Property } from "./Property";
import { BaseEntity, Repository, Connection } from "typeorm";

import { convertFilter } from "./utils/convertFilter";

import { BaseResource, ValidationError, Filter, BaseRecord } from 'admin-bro'
import { ParamsType } from "admin-bro/types/src/backend/adapters/base-record";

export class Resource extends BaseResource
{
    public static validate: any
    private model: typeof BaseEntity;
    private propsObject: Record<string, Property> = {};

    constructor(model: typeof BaseEntity)
    {
        super(model);

        this.model = model;
        this.prepareProps();
    }

    public databaseName(): string
    {
        return this.model.getRepository().metadata.connection.options.database as string || 'typeorm'
    }

    public databaseType(): string
    {
        return this.model.getRepository().metadata.connection.options.type || 'typeorm'
    }

    public name(): string
    {
        return this.model.name;
    }

    public id()
    {
        return this.model.name;
    }

    public properties()
    {
        return [ ...Object.values(this.propsObject) ];
    }

    public property(path: string): Property | null
    {
        return this.propsObject[ path ] || null;
    }

    public async count(filter)
    {
        return this.model.count(({
            where: convertFilter(filter),
        }));
    }

    public async populate(baseRecords, property: Property)
    {
        const fks: Array<any> = baseRecords.map(baseRecord => baseRecord.params[ property.name() ]);

        const instances = await this.model.findByIds(fks);
        const instancesRecord: Record<string, BaseEntity> = {};
        for (const instance of instances)
        {
            if (instance.hasId())
                instancesRecord[ (instance as any).id ] = instance;
        }

        baseRecords.forEach((baseRecord) =>
        {
            const fk = baseRecord.params[ property.name() ];
            const instance = instancesRecord[ fk ];
            if (instance)
                baseRecord.populated[ property.name() ] = new BaseRecord(instance, this);
        });
        return baseRecords;
    }

    public async find(filter: Filter, { limit = 10, offset = 0, sort = {} })
    {
        const { direction, sortBy } = sort as any;
        const instances = await this.model.find({
            where: convertFilter(filter),
            take: limit,
            skip: offset,
            order: {
                [ sortBy ]: (direction || "asc").toUpperCase()
            }
        });
        return instances.map(instance => new BaseRecord(instance, this));
    }

    public async findOne(id)
    {
        return new BaseRecord(await this.model.findOne(id), this);
    }

    public async findById(id)
    {
        return await this.model.findOne(id);
    }

    public async create(params: any): Promise<ParamsType>
    {
        const instance = await this.model.create(this.prepareParams(params));

        await this.validateAndSave(instance)
        
        return instance;
    }

    public async update(pk, params: any = {}): Promise<ParamsType>
    {
        const instance = await this.model.findOne(pk);
        if (instance)
        {
            params = this.prepareParams(params);
            for (const p in params)
                instance[ p ] = params[ p ];
            await this.validateAndSave(instance)
            return instance;
        }
        throw new Error("Instance not found.");
    }

    public async delete(pk)
    {
        await this.model.delete(pk);
    }

    private prepareProps()
    {
        const columns = this.model.getRepository().metadata.columns;
        for (const col of columns)
        {
            const property = new Property(col);
            this.propsObject[ property.path() ] = property;
        }
    }

    private prepareParams(params: Object): Object
    {
        for(const p in params)
        {
            const property = this.property(p);
            if(property && property.type() === 'mixed')
                params[p] = JSON.parse(params[p]);
            if(property && property.type() === 'number' && params[p] && params[p].toString().length)
                params[p] = +params[p];
            if(property && property.type() === 'reference' && params[p] && params[p].toString().length){
                /**
                 * references cannot be stored as an IDs in typeorm, so in order to mimic this )and
                 * not fetching reference resource) we are changing this: 
                 * { postId: "1" }
                 * to this:
                 * { post: { id: 1 } }
                 */
                params[property.column.propertyName] = { id: +params[p] }
            }

        }
        return params;
    }

    private async validateAndSave(instance: BaseEntity) {
        if (Resource.validate) {
            const errors = await Resource.validate(instance)
            if (errors && errors.length) {
                const validationErrors = errors.reduce((memo, error) => ({
                    ...memo,
                    [error.property]: {
                        type: Object.keys(error.constraints)[0],
                        message: Object.values(error.constraints)[0],
                    }
                }), {})
                throw new ValidationError(`${this.name()} validation failed`, validationErrors);
            }
        }
        try {
            await instance.save();
        } catch (error) {
            if (error.name === 'QueryFailedError') {
                throw new ValidationError(`${this.name()} validation failed`, {
                    [error.column]: {
                        type: 'schema error',
                        message: error.message
                    }
                });
            }
        }
    }

    public static isAdapterFor(rawResource: any)
    {
        try
        {
            return !!rawResource.getRepository().metadata;
        }
        catch (e)
        {
            return false;
        }
    }
}