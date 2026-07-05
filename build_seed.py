# -*- coding: utf-8 -*-
import openpyxl, uuid, re

SRC = r'C:\Users\66app\OneDrive\Desktop\교과별 단원.xlsx'
wb = openpyxl.load_workbook(SRC, data_only=True)

# 시트 -> 과목 메타데이터 (과목명 값 기준으로 매핑)
META = {
    '통합과학1':      ('통합과학 1',      'public',     'blue',    '과학의 기초부터 물질·시스템·생명까지 자연 현상을 통합적으로 이해합니다.'),
    '통합과학2':      ('통합과학 2',      'public',     'blue',    '변화와 다양성, 환경과 에너지, 과학과 미래 사회를 탐구합니다.'),
    '과학탐구실험1':  ('과학탐구실험 1',  'experiment', 'emerald', '과학사 속 탐구를 직접 체험하며 과학의 본성과 탐구 과정을 익힙니다.'),
    '과학탐구실험2':  ('과학탐구실험 2',  'experiment', 'emerald', '생활 속 과학과 첨단 과학을 직접 실험하고 탐구합니다.'),
    '화학':           ('화학',            'labs',       'orange',  '화학의 언어부터 물질의 구조, 화학 평형과 역동적 반응까지 탐구합니다.'),
    '물질과 에너지':  ('물질과 에너지',   'bolt',       'violet',  '물질의 상태와 용액, 화학 변화의 자발성과 반응 속도를 다룹니다.'),
    '화학반응의세계': ('화학반응의 세계', 'science',    'rose',    '산·염기 평형, 산화·환원, 탄소 화합물 반응을 깊이 있게 탐구합니다.'),
}

def strip_num(s):
    # 소단원 앞의 "01. ", "1. " 제거 (UI가 번호 배지를 따로 붙임)
    return re.sub(r'^\s*\d+\.\s*', '', s).strip()

subjects, units, mids, subs = [], [], [], []
s_ord = 0

for ws in wb.worksheets:
    rows = list(ws.iter_rows(values_only=True))
    header = [('' if c is None else str(c)).strip() for c in rows[0]]
    has_sub = len(header) >= 4 and header[3] == '소단원'

    cur_subj = cur_unit = cur_mid = None
    u_ord = m_ord = sub_ord = 0

    for raw in rows[1:]:
        cells = [('' if c is None else str(c)).strip() for c in raw]
        while len(cells) < 4:
            cells.append('')
        c_subj, c_unit, c_mid, c_sub = cells[0], cells[1], cells[2], cells[3]

        if c_subj:
            name, icon, accent, desc = META[c_subj]
            s_ord += 1
            cur_subj = uuid.uuid4().hex
            subjects.append((cur_subj, name, desc, icon, accent, s_ord))
            cur_unit = cur_mid = None
            u_ord = 0
        if c_unit:
            u_ord += 1
            cur_unit = uuid.uuid4().hex
            units.append((cur_unit, cur_subj, c_unit, u_ord))
            cur_mid = None
            m_ord = 0
            if not has_sub:
                # 소단원 없는 과목(과학탐구실험): 대단원마다 '탐구 활동' 중단원 1개 생성
                m_ord += 1
                cur_mid = uuid.uuid4().hex
                mids.append((cur_mid, cur_unit, '탐구 활동', m_ord))
                sub_ord = 0
        if has_sub:
            if c_mid:
                m_ord += 1
                cur_mid = uuid.uuid4().hex
                mids.append((cur_mid, cur_unit, c_mid, m_ord))
                sub_ord = 0
            if c_sub:
                sub_ord += 1
                subs.append((uuid.uuid4().hex, cur_mid, strip_num(c_sub), sub_ord))
        else:
            # 중단원 칸(활동)을 소단원으로
            if c_mid:
                sub_ord += 1
                subs.append((uuid.uuid4().hex, cur_mid, strip_num(c_mid), sub_ord))

def q(s):
    return "'" + s.replace("'", "''") + "'"

# id -> 이름 조회용
u_name = {i: n for (i, p, n, o) in units}
u_subj = {i: p for (i, p, n, o) in units}
s_name = {i: n for (i, n, d, ic, ac, o) in subjects}
m_name = {i: n for (i, p, n, o) in mids}
m_unit = {i: p for (i, p, n, o) in mids}

lines = []
lines.append('-- 엑셀(교과별 단원.xlsx) 기반 교육과정 시드 (이름 기준 연결, UUID 불필요)')
lines.append('delete from subjects;')  # cascade 로 하위 전부 삭제

lines.append('insert into subjects (name,description,icon,accent,sort_order,is_active) values')
lines.append(',\n'.join(
    f'({q(n)},{q(d)},{q(ic)},{q(ac)},{o},true)' for (i,n,d,ic,ac,o) in subjects) + ';')

lines.append('insert into units (subject_id,name,sort_order,is_active)')
lines.append('select s.id, v.name, v.ord, true from (values')
lines.append(',\n'.join(
    f'({q(s_name[p])},{q(n)},{o})' for (i,p,n,o) in units))
lines.append(') as v(subj,name,ord) join subjects s on s.name=v.subj;')

lines.append('insert into mid_units (unit_id,name,sort_order,is_active)')
lines.append('select u.id, v.name, v.ord, true from (values')
lines.append(',\n'.join(
    f'({q(s_name[u_subj[p]])},{q(u_name[p])},{q(n)},{o})' for (i,p,n,o) in mids))
lines.append(') as v(subj,unit,name,ord) join subjects s on s.name=v.subj join units u on u.subject_id=s.id and u.name=v.unit;')

lines.append('insert into subunits (mid_unit_id,name,description,sort_order,is_active)')
lines.append("select m.id, v.name, '', v.ord, true from (values")
lines.append(',\n'.join(
    f'({q(s_name[u_subj[m_unit[p]]])},{q(u_name[m_unit[p]])},{q(m_name[p])},{q(n)},{o})' for (i,p,n,o) in subs))
lines.append(') as v(subj,unit,mid,name,ord) join subjects s on s.name=v.subj join units u on u.subject_id=s.id and u.name=v.unit join mid_units m on m.unit_id=u.id and m.name=v.mid;')

open('seed.sql','w',encoding='utf-8').write('\n'.join(lines))
print(f'subjects={len(subjects)} units={len(units)} mids={len(mids)} subunits={len(subs)}')
print('seed.sql bytes:', len('\n'.join(lines).encode('utf-8')))
