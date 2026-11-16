import mongoose from 'mongoose';
import { fileDb, generateId, DatabaseState } from '../config/db.js';

export function isMongoActive(): boolean {
  return mongoose.connection.readyState === 1 && !!mongoose.connection.db;
}

export interface QueryOptions {
  sort?: Record<string, 1 | -1>;
  skip?: number;
  limit?: number;
  populateFields?: string[];
}

export class QueryBuilder<T = any> implements PromiseLike<T[]> {
  protected collectionName: keyof DatabaseState;
  protected filter: any;
  protected options: QueryOptions = {};

  constructor(collectionName: keyof DatabaseState, filter: any = {}) {
    this.collectionName = collectionName;
    this.filter = filter;
  }

  sort(sortObj: Record<string, 1 | -1>) {
    this.options.sort = sortObj;
    return this;
  }

  skip(n: number) {
    this.options.skip = n;
    return this;
  }

  limit(n: number) {
    this.options.limit = n;
    return this;
  }

  populate(field: string) {
    if (!this.options.populateFields) {
      this.options.populateFields = [];
    }
    this.options.populateFields.push(field);
    return this;
  }

  protected matches(item: any, filter: any): boolean {
    if (!filter || Object.keys(filter).length === 0) return true;

    for (const key of Object.keys(filter)) {
      if (key === '$or' && Array.isArray(filter.$or)) {
        const matchesAny = filter.$or.some((subFilter: any) => this.matches(item, subFilter));
        if (!matchesAny) return false;
        continue;
      }

      if (key === '$and' && Array.isArray(filter.$and)) {
        const matchesAll = filter.$and.every((subFilter: any) => this.matches(item, subFilter));
        if (!matchesAll) return false;
        continue;
      }

      const expected = filter[key];
      const actual = item[key];

      if (expected && typeof expected === 'object' && !Array.isArray(expected)) {
        if ('$in' in expected && Array.isArray(expected.$in)) {
          if (!expected.$in.includes(actual)) return false;
          continue;
        }
        if ('$nin' in expected && Array.isArray(expected.$nin)) {
          if (expected.$nin.includes(actual)) return false;
          continue;
        }
        if ('$ne' in expected) {
          if (actual === expected.$ne) return false;
          continue;
        }
        if ('$gte' in expected) {
          if (Number(actual) < Number(expected.$gte)) return false;
          continue;
        }
        if ('$lte' in expected) {
          if (Number(actual) > Number(expected.$lte)) return false;
          continue;
        }
        if ('$gt' in expected) {
          if (Number(actual) <= Number(expected.$gt)) return false;
          continue;
        }
        if ('$lt' in expected) {
          if (Number(actual) >= Number(expected.$lt)) return false;
          continue;
        }
        if ('$regex' in expected) {
          const re = new RegExp(expected.$regex, expected.$options || 'i');
          if (!re.test(String(actual || ''))) return false;
          continue;
        }
      }

      if (Array.isArray(actual) && !Array.isArray(expected)) {
        if (!actual.includes(expected)) return false;
        continue;
      }

      if (actual !== expected) {
        return false;
      }
    }

    return true;
  }

  protected execute(): T[] {
    const list = fileDb.getCollection<any>(this.collectionName);
    let results = list.filter((item) => this.matches(item, this.filter));

    if (this.options.sort) {
      const [field, dir] = Object.entries(this.options.sort)[0];
      results.sort((a, b) => {
        const valA = a[field];
        const valB = b[field];
        if (valA === valB) return 0;
        if (valA === undefined) return 1;
        if (valB === undefined) return -1;
        if (dir === 1) return valA > valB ? 1 : -1;
        return valA < valB ? 1 : -1;
      });
    }

    if (this.options.skip && this.options.skip > 0) {
      results = results.slice(this.options.skip);
    }

    if (this.options.limit && this.options.limit > 0) {
      results = results.slice(0, this.options.limit);
    }

    results = results.map((item) => ({ ...item }));

    if (this.options.populateFields && this.options.populateFields.length > 0) {
      for (const field of this.options.populateFields) {
        this.populateField(results, field);
      }
    }

    return results;
  }

  protected async executeMongo(): Promise<T[]> {
    const col = mongoose.connection.db!.collection(this.collectionName);
    let cursor = col.find(this.filter || {});
    if (this.options.sort) {
      cursor = cursor.sort(this.options.sort);
    }
    if (this.options.skip && this.options.skip > 0) {
      cursor = cursor.skip(this.options.skip);
    }
    if (this.options.limit && this.options.limit > 0) {
      cursor = cursor.limit(this.options.limit);
    }
    const results = (await cursor.toArray()) as any[];
    if (this.options.populateFields && this.options.populateFields.length > 0) {
      for (const field of this.options.populateFields) {
        await this.populateFieldMongo(results, field);
      }
    }
    return results as T[];
  }

  protected async populateFieldMongo(items: any[], field: string) {
    const db = mongoose.connection.db!;
    for (const item of items) {
      if (field === 'user' && item.userId) {
        const u = await db.collection('users').findOne({ _id: item.userId });
        if (u) {
          const { passwordHash, ...safeUser } = u;
          item.user = safeUser;
        }
      } else if (field === 'student' && item.studentId) {
        const u = await db.collection('users').findOne({ _id: item.studentId });
        if (u) {
          const { passwordHash, ...safeUser } = u;
          item.student = safeUser;
        }
      } else if (field === 'leader' && item.leaderId) {
        const u = await db.collection('users').findOne({ _id: item.leaderId });
        if (u) {
          const { passwordHash, ...safeUser } = u;
          item.leader = safeUser;
        }
      } else if (field === 'sender' && item.senderId) {
        const u = await db.collection('users').findOne({ _id: item.senderId });
        if (u) {
          const { passwordHash, ...safeUser } = u;
          item.sender = safeUser;
        }
      } else if (field === 'receiver' && item.receiverId) {
        const u = await db.collection('users').findOne({ _id: item.receiverId });
        if (u) {
          const { passwordHash, ...safeUser } = u;
          item.receiver = safeUser;
        }
      } else if (field === 'project' && item.projectId) {
        item.project = await db.collection('projects').findOne({ _id: item.projectId });
      } else if (field === 'team' && item.teamId) {
        item.team = await db.collection('teams').findOne({ _id: item.teamId });
      } else if (field === 'company' && item.companyId) {
        item.company = await db.collection('companyProfiles').findOne({
          $or: [{ _id: item.companyId }, { userId: item.companyId }],
        });
      }
    }
  }

  protected populateField(items: any[], field: string) {
    for (const item of items) {
      if (field === 'user' && item.userId) {
        const u = fileDb.getCollection('users').find((x) => x._id === item.userId);
        if (u) {
          const { passwordHash, ...safeUser } = u;
          item.user = safeUser;
        }
      } else if (field === 'student' && item.studentId) {
        const u = fileDb.getCollection('users').find((x) => x._id === item.studentId);
        if (u) {
          const { passwordHash, ...safeUser } = u;
          item.student = safeUser;
        }
      } else if (field === 'leader' && item.leaderId) {
        const u = fileDb.getCollection('users').find((x) => x._id === item.leaderId);
        if (u) {
          const { passwordHash, ...safeUser } = u;
          item.leader = safeUser;
        }
      } else if (field === 'sender' && item.senderId) {
        const u = fileDb.getCollection('users').find((x) => x._id === item.senderId);
        if (u) {
          const { passwordHash, ...safeUser } = u;
          item.sender = safeUser;
        }
      } else if (field === 'receiver' && item.receiverId) {
        const u = fileDb.getCollection('users').find((x) => x._id === item.receiverId);
        if (u) {
          const { passwordHash, ...safeUser } = u;
          item.receiver = safeUser;
        }
      } else if (field === 'project' && item.projectId) {
        item.project = fileDb.getCollection('projects').find((x) => x._id === item.projectId);
      } else if (field === 'team' && item.teamId) {
        item.team = fileDb.getCollection('teams').find((x) => x._id === item.teamId);
      } else if (field === 'company' && item.companyId) {
        item.company = fileDb
          .getCollection('companyProfiles')
          .find((x) => x._id === item.companyId || x.userId === item.companyId);
      }
    }
  }

  then<TResult1 = T[], TResult2 = never>(
    onfulfilled?: ((value: T[]) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null
  ): Promise<TResult1 | TResult2> {
    const p = isMongoActive() ? this.executeMongo() : Promise.resolve(this.execute());
    return p.then(onfulfilled, onrejected);
  }
}

export class QueryBuilderSingle<T = any> implements PromiseLike<T | null> {
  private qb: QueryBuilder<T>;

  constructor(collectionName: keyof DatabaseState, filter: any = {}) {
    this.qb = new QueryBuilder<T>(collectionName, filter).limit(1);
  }

  populate(field: string) {
    this.qb.populate(field);
    return this;
  }

  then<TResult1 = T | null, TResult2 = never>(
    onfulfilled?: ((value: T | null) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null
  ): Promise<TResult1 | TResult2> {
    return this.qb.then((items) => (items.length > 0 ? items[0] : null)).then(onfulfilled, onrejected);
  }
}

export class Model<T = any> {
  protected collectionName: keyof DatabaseState;

  constructor(collectionName: keyof DatabaseState) {
    this.collectionName = collectionName;
  }

  find(filter: any = {}): QueryBuilder<T> {
    return new QueryBuilder<T>(this.collectionName, filter);
  }

  findOne(filter: any = {}): QueryBuilderSingle<T> {
    return new QueryBuilderSingle<T>(this.collectionName, filter);
  }

  findById(id: string): QueryBuilderSingle<T> {
    return this.findOne({ _id: id });
  }

  async countDocuments(filter: any = {}): Promise<number> {
    if (isMongoActive()) {
      return await mongoose.connection.db!.collection(this.collectionName).countDocuments(filter);
    }
    const list = await this.find(filter);
    return list.length;
  }

  async create(data: Partial<T>): Promise<T> {
    const now = new Date().toISOString();
    const doc: any = {
      _id: (data as any)._id || generateId(),
      ...data,
      createdAt: (data as any).createdAt || now,
      updatedAt: (data as any).updatedAt || now,
    };
    if (isMongoActive()) {
      await mongoose.connection.db!.collection(this.collectionName).insertOne({ ...doc });
      return { ...doc };
    }
    // Only fallback to fileDb if MongoDB is not active
    const coll = fileDb.getCollection<any>(this.collectionName);
    coll.push(doc);
    fileDb.save();
    return { ...doc };
  }

  async insertMany(docs: Partial<T>[]): Promise<T[]> {
    const created: T[] = [];
    for (const d of docs) {
      const item = await this.create(d);
      created.push(item);
    }
    return created;
  }

  async findByIdAndUpdate(id: string, update: any, options: { new?: boolean } = { new: true }): Promise<T | null> {
    const now = new Date().toISOString();

    if (isMongoActive()) {
      let updateDoc: any = {};
      if (update.$set || update.$push || update.$pull) {
        updateDoc = { ...update };
        if (!updateDoc.$set) updateDoc.$set = {};
        updateDoc.$set.updatedAt = now;
      } else {
        updateDoc = { $set: { ...update, updatedAt: now } };
      }
      const res = await mongoose.connection.db!.collection(this.collectionName).findOneAndUpdate(
        { _id: id as any },
        updateDoc,
        { returnDocument: 'after' }
      );
      const mongoDoc = (res && typeof res === 'object' && 'value' in res) ? (res as any).value : res;
      return mongoDoc as T | null;
    }

    // Only fallback to fileDb if MongoDB is not active
    const coll = fileDb.getCollection<any>(this.collectionName);
    const index = coll.findIndex((item) => item._id === id);
    if (index !== -1) {
      const current = coll[index];
      let updatedDoc: any;

      if (update.$set) {
        updatedDoc = { ...current, ...update.$set, updatedAt: now };
      } else if (update.$push) {
        updatedDoc = { ...current };
        for (const [k, v] of Object.entries(update.$push)) {
          if (!Array.isArray(updatedDoc[k])) updatedDoc[k] = [];
          updatedDoc[k].push(v);
        }
        updatedDoc.updatedAt = now;
      } else if (update.$pull) {
        updatedDoc = { ...current };
        for (const [k, v] of Object.entries(update.$pull)) {
          if (Array.isArray(updatedDoc[k])) {
            updatedDoc[k] = updatedDoc[k].filter((elem: any) => {
              if (typeof v === 'object' && v !== null) {
                return Object.entries(v).some(([subK, subV]) => elem[subK] !== subV);
              }
              return elem !== v;
            });
          }
        }
        updatedDoc.updatedAt = now;
      } else {
        updatedDoc = { ...current, ...update, updatedAt: now };
      }

      coll[index] = updatedDoc;
      fileDb.save();
    }

    return index !== -1 ? coll[index] : null;
  }

  async updateOne(filter: any, update: any): Promise<{ modifiedCount: number }> {
    if (isMongoActive()) {
      let updateDoc: any = {};
      if (update.$set || update.$push || update.$pull) {
        updateDoc = { ...update };
      } else {
        updateDoc = { $set: update };
      }
      const res = await mongoose.connection.db!.collection(this.collectionName).updateOne(filter, updateDoc);
      return { modifiedCount: res.modifiedCount };
    }
    const target = await this.findOne(filter);
    if (!target) return { modifiedCount: 0 };
    await this.findByIdAndUpdate((target as any)._id, update);
    return { modifiedCount: 1 };
  }

  async updateMany(filter: any, update: any): Promise<{ modifiedCount: number }> {
    if (isMongoActive()) {
      let updateDoc: any = {};
      if (update.$set || update.$push || update.$pull) {
        updateDoc = { ...update };
      } else {
        updateDoc = { $set: update };
      }
      const res = await mongoose.connection.db!.collection(this.collectionName).updateMany(filter, updateDoc);
      return { modifiedCount: res.modifiedCount };
    }
    const targets = await this.find(filter);
    let count = 0;
    for (const t of targets) {
      await this.findByIdAndUpdate((t as any)._id, update);
      count++;
    }
    return { modifiedCount: count };
  }

  async findByIdAndDelete(id: string): Promise<T | null> {
    if (isMongoActive()) {
      const res = await mongoose.connection.db!.collection(this.collectionName).findOneAndDelete({ _id: id as any });
      const mongoDoc = (res && typeof res === 'object' && 'value' in res) ? (res as any).value : res;
      return mongoDoc as T | null;
    }
    const coll = fileDb.getCollection<any>(this.collectionName);
    const index = coll.findIndex((item) => item._id === id);
    const fileDoc = index !== -1 ? coll.splice(index, 1)[0] : null;
    fileDb.save();
    return fileDoc;
  }

  async deleteMany(filter: any = {}): Promise<{ deletedCount: number }> {
    if (isMongoActive()) {
      const res = await mongoose.connection.db!.collection(this.collectionName).deleteMany(filter);
      return { deletedCount: res.deletedCount };
    }
    const coll = fileDb.getCollection<any>(this.collectionName);
    const targets = await this.find(filter);
    const targetIds = new Set(targets.map((t: any) => t._id));
    const initialLen = coll.length;
    const filtered = coll.filter((item: any) => !targetIds.has(item._id));
    coll.length = 0;
    coll.push(...filtered);
    fileDb.save();
    return { deletedCount: initialLen - filtered.length };
  }
}
