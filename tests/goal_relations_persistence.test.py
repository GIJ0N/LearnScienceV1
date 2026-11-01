import copy
import tempfile
import unittest
from pathlib import Path
import sys

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from memory_store import DurableMemory,validate_store
from tools.seed_visual_demo import seed


class GoalRelationPersistenceTest(unittest.TestCase):
    def test_relation_round_trip_export_and_profile_deletion(self):
        with tempfile.TemporaryDirectory() as td:
            db=Path(td)/'relations.sqlite3'
            created=seed(db);memory=DurableMemory(db)
            loaded=memory.load(created['profile_id'])
            relation=loaded['store']['goal_relations'][0]
            self.assertEqual(relation['endpoint_status'],'available')
            self.assertNotEqual(relation['source']['goal_id'],relation['target']['goal_id'])
            self.assertEqual(memory.export(created['profile_id'])['store']['goal_relations'][0]['relation_id'],relation['relation_id'])
            memory.delete_profile(created['profile_id'])
            self.assertFalse(any(item['profile_id']==created['profile_id'] for item in memory.profiles()))

    def test_missing_endpoint_is_preserved_but_never_reassigned(self):
        with tempfile.TemporaryDirectory() as td:
            created=seed(Path(td)/'relations.sqlite3');memory=DurableMemory(created['database'])
            store=memory.load(created['profile_id'])['store']
            store['goals']=[goal for goal in store['goals'] if goal['id']=='visual-goal']
            normalized,_=validate_store(store,created['profile_id'])
            relation=normalized['goal_relations'][0]
            self.assertEqual(relation['endpoint_status'],'missing')
            self.assertEqual(relation['target'],{'goal_id':'visual-goal-physics','node_id':'modelo'})

    def test_cross_profile_and_malformed_relations_are_rejected(self):
        with tempfile.TemporaryDirectory() as td:
            created=seed(Path(td)/'relations.sqlite3');memory=DurableMemory(created['database'])
            store=memory.load(created['profile_id'])['store']
            foreign=copy.deepcopy(store);foreign['goal_relations'][0]['profile_id']='other-profile'
            with self.assertRaisesRegex(ValueError,'otro perfil'):
                validate_store(foreign,created['profile_id'])
            duplicate=copy.deepcopy(store);duplicate['goal_relations'].append(copy.deepcopy(duplicate['goal_relations'][0]))
            with self.assertRaisesRegex(ValueError,'únicos'):
                validate_store(duplicate,created['profile_id'])
            cycle=copy.deepcopy(store);first=cycle['goal_relations'][0]
            first['type']='prerequisite';first['status']='confirmed'
            reverse=copy.deepcopy(first);reverse['relation_id']='reverse-prerequisite'
            reverse['source'],reverse['target']=copy.deepcopy(first['target']),copy.deepcopy(first['source'])
            cycle['goal_relations'].append(reverse)
            with self.assertRaisesRegex(ValueError,'ciclo'):
                validate_store(cycle,created['profile_id'])

    def test_restore_rebinds_relation_owner_but_ordinary_save_rejects_it(self):
        with tempfile.TemporaryDirectory() as td:
            created=seed(Path(td)/'relations.sqlite3');memory=DurableMemory(created['database'])
            backup=memory.export(created['profile_id'])
            target=memory.create_profile('Destino sintético')
            foreign=copy.deepcopy(backup['store'])
            with self.assertRaisesRegex(ValueError,'otro perfil'):
                memory.save(target['profile_id'],foreign,expected_revision=target['revision'])
            restored=memory.restore(target['profile_id'],backup)
            self.assertTrue(restored['restored'])
            loaded=memory.load(target['profile_id'])['store']
            self.assertEqual(loaded['goal_relations'][0]['profile_id'],target['profile_id'])
            self.assertEqual(loaded['goal_relations'][0]['source'],backup['store']['goal_relations'][0]['source'])
            self.assertEqual(loaded['goal_relations'][0]['target'],backup['store']['goal_relations'][0]['target'])


if __name__=='__main__':
    unittest.main()
