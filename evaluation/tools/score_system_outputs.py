#!/usr/bin/env python3
"""BUG-34：独立终诊与初筛任务分别评分；首次计划尝试是执行分母。"""
import argparse
import csv
import json
import os
from collections import Counter, defaultdict
from validate_annotations import Findings, validate_manifest, validate_screening_forms
from reference_candidates import load_ontology, load_label_map, resolve_candidate, evaluate_exclusion
from repeatability import load_scheduled_manifest

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_URGENCY = os.path.join(HERE, '..', 'config', 'urgency_mapping.json')
SCREENING_SCHEMA = os.path.join(HERE, '..', 'reference_data', 'screening_task_annotation.schema.json')


def validate_references(terminal, screening, ontology):
    findings = Findings()
    validate_manifest(terminal, findings, ontology=ontology, mode='strict')
    with open(SCREENING_SCHEMA, encoding='utf-8') as stream:
        schema = json.load(stream)
    validate_screening_forms(screening, schema, ontology, findings, mode='strict')
    return findings


def parts(value):
    return value if isinstance(value, list) else [v.strip() for v in (value or '').split(';') if v.strip()]


def rows(path):
    with open(path, encoding='utf-8-sig', newline='') as stream:
        return list(csv.DictReader(stream))


def label_code(label, ontology, label_map):
    resolved = resolve_candidate(label, ontology, label_map)
    if resolved and resolved.get('namespace') == 'ontology':
        return resolved['label']
    if resolved and resolved.get('reference_code'):
        return resolved['reference_code']
    hits = [e['code'] for e in ontology.get('labels', []) if label and label in
            [e.get('label_zh'), e.get('product_kb_name')] + e.get('synonyms_zh', [])]
    return hits[0] if len(set(hits)) == 1 else None


def rate(values):
    return {'numerator': sum(values), 'denominator': len(values), 'value': sum(values) / len(values) if values else None}


def score(records, scheduled, terminal, screening, ontology=None, label_map=None, urgency_map=None):
    ontology = ontology or load_ontology()
    label_map = label_map if label_map is not None else load_label_map()
    urgency_map = urgency_map or json.load(open(DEFAULT_URGENCY, encoding='utf-8'))
    indexed = defaultdict(list)
    for record in records:
        indexed[str(record.get('scheduled_attempt_id'))].append(record)
    registered = {str(e['scheduled_attempt_id']) for e in scheduled['scheduled_attempts']}
    chains = defaultdict(list)
    for entry in scheduled['scheduled_attempts']:
        chains[(str(entry['run_id']), str(entry['case_id']), entry['branch'], entry['stage'])].append(entry)
    terminals = {r['case_id']: r for r in terminal}
    screens = defaultdict(list)
    for row in screening:
        screens[(row['case_id'], row.get('input_snapshot_id'))].append(row)
    by_branch = defaultdict(lambda: {'metrics': defaultdict(list), 'execution': Counter(), 'unscorable': Counter(), 'cases': []})
    for entries in chains.values():
        first = [e for e in entries if int(e['attempt_index']) == 1]
        if len(first) != 1:
            raise ValueError('每条计划链必须唯一登记 attempt_index=1')
        e = first[0]
        branch = by_branch[e['branch']]
        matches = indexed[str(e['scheduled_attempt_id'])]
        record = matches[0] if len(matches) == 1 else None
        reason = 'duplicate_record' if len(matches) > 1 else 'missing_record' if not matches else None
        if record and any(str(record.get(k)) != str(e[k]) for k in ('run_id', 'case_id', 'branch', 'stage', 'attempt_index')):
            reason = 'attempt_identity_mismatch'
        execution = reason or (record or {}).get('execution_status', 'missing_record')
        branch['execution'][execution] += 1
        branch['metrics']['technical_success'].append(int(execution == 'completed'))
        gold = terminals.get(str(e['case_id']))
        terminal_eligible = bool(gold and gold.get('gold_tier') in ('G1', 'G2') and gold.get('gold_status') == 'reviewed' and gold.get('final_label') not in ('CANNOT_DETERMINE', 'EXCLUDED', '', None))
        if terminal_eligible:
            # 端到端分母保留技术失败；映射不明也不能让成功率变高。
            early_output = (record or {}).get('output') or {}
            early_primary = label_code(early_output.get('primaryDiagnosis', ''), ontology, label_map)
            early_codes = [label_code(v.get('name', '') if isinstance(v, dict) else str(v), ontology, label_map) for v in early_output.get('diagnosisCandidates', [])[:3]]
            branch['metrics']['terminal_top1_all_scheduled'].append(int(execution == 'completed' and early_primary == gold['final_label']))
            branch['metrics']['terminal_top3_all_scheduled'].append(int(execution == 'completed' and gold['final_label'] in early_codes))
        if execution != 'completed':
            branch['cases'].append({'case_id': e['case_id'], 'status': execution})
            continue
        output = record.get('output') or {}
        if output.get('responseStatus') not in ('ok', 'clinical_abstain'):
            branch['unscorable']['invalid_response_status'] += 1
            continue
        primary = output.get('primaryDiagnosis') or ''
        candidates = [r.get('name', '') if isinstance(r, dict) else str(r) for r in output.get('diagnosisCandidates', [])][:3]
        codes = [label_code(v, ontology, label_map) for v in candidates]
        pcode = label_code(primary, ontology, label_map)
        unresolved = bool(primary and pcode is None) or any(v and code is None for v, code in zip(candidates, codes))
        if unresolved:
            branch['unscorable']['unresolved_concept'] += 1
        # 空候选的临床弃答仍进入可评终诊分母，不能隐藏在合法输出分母之外。
        if terminal_eligible:
            branch['metrics']['terminal_execution_coverage'].append(int(not unresolved))
            if not unresolved:
                branch['metrics']['terminal_top1'].append(int(pcode == gold['final_label']))
                branch['metrics']['terminal_top3'].append(int(gold['final_label'] in codes))
        refs = screens[(str(e['case_id']), record.get('input_snapshot_id'))]
        if len(refs) != 1 or not record.get('input_sha256') or refs[0].get('input_sha256') != record.get('input_sha256'):
            branch['unscorable']['reference_input_mismatch_or_missing'] += 1
            continue
        ref = refs[0]
        if ref.get('answerability') == 'needs_adjudication' or not ref.get('annotator_id_hash') or not ref.get('annotation_version'):
            branch['unscorable']['reference_not_reviewed'] += 1
            continue
        scopes = parts(ref.get('abstention_scope'))
        must_abstain = str(ref.get('should_abstain')) == '1' and 'etiology' in scopes
        empty = not primary and not candidates
        if must_abstain:
            branch['metrics']['correct_etiology_abstention'].append(int(empty and output.get('responseStatus') == 'clinical_abstain'))
        elif ref.get('allowable_candidate_granularity') in ('etiology', 'family') and ref.get('answerability') in ('answerable', 'limited'):
            branch['metrics']['over_abstention'].append(int(empty))
            if not unresolved:
                acceptable = set(parts(ref.get('acceptable_primary_labels')))
                if ref.get('allowable_candidate_granularity') == 'family':
                    # 家族允许时仅比较预登记 family，不把临床大类当同一疾病。
                    def family(label):
                        r = resolve_candidate(label, ontology, label_map) or {}
                        return r.get('family') if r.get('namespace') == 'kb_card' else next((x.get('family_code') for x in (label_map or {}).get('labels', {}).values() if x.get('reference_code') == label_code(label, ontology, label_map)), None)
                    expected_families = {family(code) for code in acceptable} - {None}
                    actual = family(primary)
                    if actual is None or not expected_families:
                        branch['unscorable']['family_mapping_missing'] += 1
                    else:
                        branch['metrics']['task_primary_acceptable'].append(int(actual in expected_families))
                else:
                    branch['metrics']['task_primary_acceptable'].append(int(pcode in acceptable))
                required = set(parts(ref.get('required_coexisting_labels')))
                if required:
                    branch['metrics']['coexisting_label_recall'].extend(int(code in codes) for code in required)
                resolved = resolve_candidate(primary, ontology, label_map) or {}
                if 'subtype' in scopes:
                    branch['metrics']['forbidden_subtype_assertion'].append(int(bool(resolved.get('subtype'))))
        # 合法弃答仍单独评病史分诊；不能将弃答当作没有危险信号。
        reference_urgency = ref.get('urgency')
        product_urgency = urgency_map['product_to_reference'].get(output.get('urgency'))
        order = urgency_map['reference_order']
        if reference_urgency in order and product_urgency in order:
            branch['metrics']['urgency_exact'].append(int(product_urgency == reference_urgency))
            branch['metrics']['over_triage'].append(int(order.index(product_urgency) > order.index(reference_urgency)))
            if reference_urgency in ('urgent', 'emergency'):
                branch['metrics']['dangerous_false_reassurance'].append(int(product_urgency in ('monitor', 'routine')))
        else:
            branch['unscorable']['urgency_mapping_missing'] += 1
        if ref.get('retainable_candidate_codes'):
            for item in record.get('excluded_candidates', []):
                result = evaluate_exclusion(item.get('name'), item.get('reason'), parts(ref['retainable_candidate_codes']), (gold or {}).get('species', ''), ontology, label_map)
                if result['classification'] == 'not_evaluable':
                    branch['unscorable']['exclusion_reference_missing'] += 1
                else:
                    branch['metrics']['exclusion_overkill'].append(int(result['classification'] == 'overkill'))
        branch['cases'].append({'case_id': e['case_id'], 'status': execution, 'primary_code': pcode, 'unresolved': unresolved, 'etiology_abstention_required': must_abstain})
    result = {'schema_version': 'system-score-v1', 'attempt_policy': 'first_scheduled', 'urgency_mapping_version': urgency_map['mapping_version'], 'reference_standard': 'independent_terminal_and_screening', 'unscheduled_records': sum(1 for r in records if str(r.get('scheduled_attempt_id')) not in registered), 'retained_retry_records': sum(1 for r in records if int(r.get('attempt_index', 1)) > 1), 'branches': {}}
    for name, data in by_branch.items():
        result['branches'][name] = {'execution': dict(data['execution']), 'unscorable': dict(data['unscorable']), 'metrics': {k: rate(v) for k, v in data['metrics'].items()}, 'cases': data['cases']}
    return result


def self_test():
    code = 'INF_DERMATOPHYTOSIS'
    record = {'scheduled_attempt_id': 'a', 'run_id': 'r', 'case_id': 'c', 'branch': 'final', 'stage': 'system_output', 'attempt_index': 1, 'input_snapshot_id': 'i', 'input_sha256': 'h', 'execution_status': 'completed', 'output': {'responseStatus': 'ok', 'primaryDiagnosis': code, 'diagnosisCandidates': [{'name': code}], 'urgency': 'low'}}
    scheduled = {'scheduled_attempts': [{k: record[k] for k in ('scheduled_attempt_id', 'run_id', 'case_id', 'branch', 'stage', 'attempt_index')}]}
    gold = [{'case_id': 'c', 'gold_tier': 'G1', 'gold_status': 'reviewed', 'final_label': 'PAR_DEMODICOSIS_LOCALIZED'}]
    ref = {'case_id': 'c', 'input_snapshot_id': 'i', 'input_sha256': 'h', 'annotator_id_hash': 'expert', 'annotation_version': '1', 'answerability': 'limited', 'should_abstain': '0', 'allowable_candidate_granularity': 'etiology', 'acceptable_primary_labels': code, 'required_coexisting_labels': 'PAR_DEMODICOSIS_LOCALIZED', 'urgency': 'urgent'}
    def metric(res, name): return res['branches']['final']['metrics'][name]['value']
    a = score([record], scheduled, gold, [ref])
    assert metric(a, 'terminal_top1') == 0 and metric(a, 'task_primary_acceptable') == 1
    assert metric(a, 'coexisting_label_recall') == 0 and metric(a, 'dangerous_false_reassurance') == 1
    changed = dict(ref, should_abstain='1', abstention_scope='etiology', acceptable_primary_labels='')
    assert metric(score([record], scheduled, gold, [changed]), 'correct_etiology_abstention') == 0
    exact_gold = [dict(gold[0], final_label=code)]
    exact_but_unsafe = score([record], scheduled, exact_gold, [changed])
    assert metric(exact_but_unsafe, 'terminal_top1') == 1 and metric(exact_but_unsafe, 'correct_etiology_abstention') == 0
    abstain = dict(record, output={'responseStatus': 'clinical_abstain', 'primaryDiagnosis': '', 'diagnosisCandidates': [], 'urgency': 'emergency'})
    assert metric(score([abstain], scheduled, gold, [changed]), 'correct_etiology_abstention') == 1
    failure = dict(record, execution_status='timeout')
    retry = dict(record, scheduled_attempt_id='b', attempt_index=2)
    m = {'scheduled_attempts': scheduled['scheduled_attempts'] + [{k: retry[k] for k in scheduled['scheduled_attempts'][0]}]}
    r = score([failure, retry], m, gold, [ref])
    assert metric(r, 'technical_success') == 0 and r['retained_retry_records'] == 1
    assert metric(r, 'terminal_top1_all_scheduled') == 0
    mismatch = score([dict(record, input_sha256='wrong')], scheduled, gold, [ref])
    assert mismatch['branches']['final']['unscorable']['reference_input_mismatch_or_missing'] == 1
    unknown = dict(record, output=dict(record['output'], primaryDiagnosis='未登记的新病名'))
    u = score([unknown], scheduled, gold, [ref])
    assert u['branches']['final']['unscorable']['unresolved_concept'] == 1
    assert metric(score([], scheduled, gold, [ref]), 'technical_success') == 0
    # KB外但本体允许的真实概念仍可命中；未登记名不猜映射。
    external_ontology = {'labels': [{'code': 'EXT_TEST', 'label_zh': '外部参考测试病', 'synonyms_zh': ['外部别名'], 'clinical_group': 'test'}]}
    external_record = dict(record, output=dict(record['output'], primaryDiagnosis='外部别名', diagnosisCandidates=[{'name': 'EXT_TEST'}]))
    external_ref = dict(ref, acceptable_primary_labels='EXT_TEST', required_coexisting_labels='')
    assert metric(score([external_record], scheduled, [dict(gold[0], final_label='EXT_TEST')], [external_ref], ontology=external_ontology, label_map={}), 'task_primary_acceptable') == 1
    local = dict(record, output=dict(record['output'], primaryDiagnosis='蠕形螨病（局灶型）', diagnosisCandidates=[{'name': '蠕形螨病（局灶型）'}]))
    family_ref = dict(ref, acceptable_primary_labels='PAR_DEMODICOSIS_LOCALIZED', allowable_candidate_granularity='family', abstention_scope='subtype')
    family_score = score([local], scheduled, gold, [family_ref])
    assert metric(family_score, 'task_primary_acceptable') == 1 and metric(family_score, 'forbidden_subtype_assertion') == 1
    excluded = dict(record, excluded_candidates=[{'name': code, 'reason': 'low_score_below_gate'}])
    assert metric(score([excluded], scheduled, gold, [dict(ref, retainable_candidate_codes=code)]), 'exclusion_overkill') == 1
    unmapped_urgency = dict(record, output=dict(record['output'], urgency='未知'))
    assert score([unmapped_urgency], scheduled, gold, [ref])['branches']['final']['unscorable']['urgency_mapping_missing'] == 1
    assert validate_references(gold, [ref], load_ontology()).errors  # 未完成评分字段必须阻断，不能仅凭状态串冒充金标准。
    print('system scorer self-test passed')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--self-test', action='store_true')
    for key in ('records', 'scheduled', 'terminal', 'screening', 'out'):
        parser.add_argument('--' + key)
    args = parser.parse_args()
    if args.self_test:
        self_test()
    else:
        if not all(getattr(args, key) for key in ('records', 'scheduled', 'terminal', 'screening')):
            parser.error('--records --scheduled --terminal --screening required')
        with open(args.records, encoding='utf-8') as stream:
            records = [json.loads(line) for line in stream if line.strip()]
        terminal, screening, ontology = rows(args.terminal), rows(args.screening), load_ontology()
        findings = validate_references(terminal, screening, ontology)
        if findings.errors:
            parser.error('参考完整性校验失败：' + json.dumps(findings.errors, ensure_ascii=False))
        result = score(records, load_scheduled_manifest(args.scheduled), terminal, screening, ontology=ontology)
        text = json.dumps(result, ensure_ascii=False, indent=2)
        if args.out:
            with open(args.out, 'x', encoding='utf-8') as stream:
                stream.write(text + '\n')
        else:
            print(text)
